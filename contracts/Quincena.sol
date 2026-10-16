// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Quincena is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint16 private constant MAX_PERIODS = 1_000;
    /// @dev Allowed chain IDs: Arc Testnet (5042002) and Arc Mainnet (5042).
    ///      On both chains USDC is the ERC-20 at 0x3600…0000.
    ///      Reverts with WrongChain() on any other chain so stale bytecode
    ///      cannot be re-deployed where that address is not USDC.
    uint256 private constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint256 private constant ARC_MAINNET_CHAIN_ID  = 5042;

    error WrongChain();
    error InvalidArrayLengths();
    error InvalidPayeeCount();
    error ZeroAddressPayee();
    error InvalidBpsTotal();
    error InvalidAmountPerPeriod();
    error InvalidPeriods();
    error InvalidPeriodSeconds();
    error StreamNotFound();
    error NotStreamClient();
    error StreamAlreadyCancelled();
    error PeriodsTooHigh();
    error NothingToWithdraw();
    error PayeeIsClient();
    error DuplicatePayee();

    struct Stream {
        address client;
        address[] payees;
        uint16[] bps;
        uint256 amountPerPeriod;
        uint32 periodSeconds;
        uint16 periods;
        uint32 cancelNoticePeriods;
        string memo;
        uint256 startTime;
        uint16 periodsClaimedCount;
        bool cancelled;
        uint16 cancelledAtPeriod;
    }

    Stream[] private _streams;
    mapping(address => uint256[]) private _streamsOfClient;
    mapping(address => uint256[]) private _streamsOfPayee;
    mapping(address => uint256) public pendingWithdrawal;

    constructor() {
        if (block.chainid != ARC_TESTNET_CHAIN_ID && block.chainid != ARC_MAINNET_CHAIN_ID) {
            revert WrongChain();
        }
    }

    event StreamCreated(
        uint256 indexed streamId,
        address indexed client,
        uint256 amountPerPeriod,
        uint16 periods,
        uint32 periodSeconds
    );
    event PeriodPaid(uint256 indexed streamId, uint256 indexed periodIndex, uint256 total);
    event StreamCancelled(uint256 indexed streamId, uint256 cutoffPeriod, uint256 refundAmount);
    event Withdrawn(address indexed payee, uint256 amount);

    function createStream(
        address[] calldata payees,
        uint16[] calldata bps,
        uint256 amountPerPeriod,
        uint32 periodSeconds,
        uint16 periods,
        uint32 cancelNoticePeriods,
        string calldata memo
    ) external {
        _validateCreateParams(payees, bps, amountPerPeriod, periodSeconds, periods);

        uint256 streamId = _streams.length;
        _initStream(streamId, payees, bps, amountPerPeriod, periodSeconds, periods, cancelNoticePeriods, memo);

        USDC.safeTransferFrom(msg.sender, address(this), amountPerPeriod * uint256(periods));
        emit StreamCreated(streamId, msg.sender, amountPerPeriod, periods, periodSeconds);
    }

    function _validateCreateParams(
        address[] calldata payees,
        uint16[] calldata bps,
        uint256 amountPerPeriod,
        uint32 periodSeconds,
        uint16 periods
    ) internal view {
        uint256 payeeCount = payees.length;
        if (payeeCount != bps.length) revert InvalidArrayLengths();
        if (payeeCount == 0 || payeeCount > 5) revert InvalidPayeeCount();
        if (amountPerPeriod == 0) revert InvalidAmountPerPeriod();
        if (periods == 0) revert InvalidPeriods();
        if (periods > MAX_PERIODS) revert PeriodsTooHigh();
        if (periodSeconds == 0) revert InvalidPeriodSeconds();

        uint256 bpsTotal;
        for (uint256 i = 0; i < payeeCount; ++i) {
            if (payees[i] == address(0)) revert ZeroAddressPayee();
            if (payees[i] == msg.sender) revert PayeeIsClient();
            // Duplicate check: compare against all earlier entries
            for (uint256 j = 0; j < i; ++j) {
                if (payees[i] == payees[j]) revert DuplicatePayee();
            }
            bpsTotal += bps[i];
        }
        if (bpsTotal != BPS_DENOMINATOR) revert InvalidBpsTotal();
    }

    function _initStream(
        uint256 streamId,
        address[] calldata payees,
        uint16[] calldata bps,
        uint256 amountPerPeriod,
        uint32 periodSeconds,
        uint16 periods,
        uint32 cancelNoticePeriods,
        string calldata memo
    ) internal {
        Stream storage stream = _streams.push();
        stream.client = msg.sender;
        stream.amountPerPeriod = amountPerPeriod;
        stream.periodSeconds = periodSeconds;
        stream.periods = periods;
        stream.cancelNoticePeriods = cancelNoticePeriods;
        stream.memo = memo;
        stream.startTime = block.timestamp;

        uint256 payeeCount = payees.length;
        for (uint256 i = 0; i < payeeCount; ++i) {
            stream.payees.push(payees[i]);
            stream.bps.push(bps[i]);
            _streamsOfPayee[payees[i]].push(streamId);
        }
        _streamsOfClient[msg.sender].push(streamId);
    }

    function claim(uint256 streamId) external nonReentrant {
        _claim(streamId, 0);
    }

    function claim(uint256 streamId, uint256 maxPeriods) external nonReentrant {
        _claim(streamId, maxPeriods);
    }

    function _claim(uint256 streamId, uint256 maxPeriods) internal {
        Stream storage stream = _getStream(streamId);

        uint256 unlockedPeriods = _unlockedPeriods(stream);
        uint256 startPeriod = stream.periodsClaimedCount;
        if (unlockedPeriods <= startPeriod) {
            return;
        }

        uint256 periodsToProcess = unlockedPeriods - startPeriod;
        if (maxPeriods != 0 && maxPeriods < periodsToProcess) {
            periodsToProcess = maxPeriods;
        }

        uint256 endPeriod = startPeriod + periodsToProcess;

        // forge-lint: disable-next-line(unsafe-typecast)
        stream.periodsClaimedCount = uint16(endPeriod); // safe: endPeriod <= unlockedPeriods <= stream.periods (uint16)

        uint256 payeeCount = stream.payees.length;
        uint256 amountPerPeriod = stream.amountPerPeriod;

        for (uint256 periodIndex = startPeriod; periodIndex < endPeriod; ++periodIndex) {
            uint256 distributed;
            for (uint256 i = 0; i + 1 < payeeCount; ++i) {
                uint256 share = (amountPerPeriod * stream.bps[i]) / BPS_DENOMINATOR;
                distributed += share;
                pendingWithdrawal[stream.payees[i]] += share;
            }

            uint256 remainder = amountPerPeriod - distributed;
            pendingWithdrawal[stream.payees[payeeCount - 1]] += remainder;

            emit PeriodPaid(streamId, periodIndex, amountPerPeriod);
        }
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawal[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawal[msg.sender] = 0;
        USDC.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function cancel(uint256 streamId) external nonReentrant {
        Stream storage stream = _getStream(streamId);
        if (msg.sender != stream.client) revert NotStreamClient();
        if (stream.cancelled) revert StreamAlreadyCancelled();

        uint256 elapsed = block.timestamp - stream.startTime;
        uint256 noticeSeconds = uint256(stream.cancelNoticePeriods) * stream.periodSeconds;
        uint256 cutoffPeriod = (elapsed + noticeSeconds) / stream.periodSeconds;
        if (cutoffPeriod > stream.periods) {
            cutoffPeriod = stream.periods;
        }

        stream.cancelled = true;
        // forge-lint: disable-next-line(unsafe-typecast)
        stream.cancelledAtPeriod = uint16(cutoffPeriod); // safe: capped to stream.periods (uint16)

        // Refund only periods that have neither been claimed nor locked-in by notice.
        // If periodsClaimedCount already exceeds cutoffPeriod (claims ran ahead of the cancel),
        // use periodsClaimedCount as the floor so we never refund already-distributed amounts.
        uint256 paidOrLocked = cutoffPeriod > stream.periodsClaimedCount
            ? cutoffPeriod
            : stream.periodsClaimedCount;
        uint256 refundPeriods = uint256(stream.periods) - paidOrLocked;
        uint256 refundAmount = refundPeriods * stream.amountPerPeriod;

        if (refundAmount > 0) {
            USDC.safeTransfer(stream.client, refundAmount);
        }

        emit StreamCancelled(streamId, cutoffPeriod, refundAmount);
    }

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return _getStream(streamId);
    }

    function claimable(uint256 streamId) external view returns (uint256 amount, uint256 numPeriods) {
        Stream storage stream = _getStream(streamId);
        uint256 unlockedPeriods = _unlockedPeriods(stream);

        uint256 claimed = stream.periodsClaimedCount;
        if (unlockedPeriods <= claimed) {
            return (0, 0);
        }

        numPeriods = unlockedPeriods - claimed;
        amount = numPeriods * stream.amountPerPeriod;
    }

    function streamsOfClient(address client) external view returns (uint256[] memory) {
        return _streamsOfClient[client];
    }

    function streamsOfPayee(address payee) external view returns (uint256[] memory) {
        return _streamsOfPayee[payee];
    }

    function _unlockedPeriods(Stream storage stream) internal view returns (uint256 unlockedPeriods) {
        uint256 elapsed = block.timestamp - stream.startTime;
        unlockedPeriods = elapsed / stream.periodSeconds;
        if (unlockedPeriods > stream.periods) {
            unlockedPeriods = stream.periods;
        }
        if (stream.cancelled && unlockedPeriods > stream.cancelledAtPeriod) {
            unlockedPeriods = stream.cancelledAtPeriod;
        }
    }

    function _getStream(uint256 streamId) internal view returns (Stream storage stream) {
        if (streamId >= _streams.length) revert StreamNotFound();
        stream = _streams[streamId];
    }
}
