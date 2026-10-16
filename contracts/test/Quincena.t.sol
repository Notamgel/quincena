// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Quincena} from "../Quincena.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Test-D helper contracts (reentrancy via ERC-20 callback)
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Standalone ERC-20 that fires `onERC20Received(amount)` on `to` if
///      `to` is a contract, simulating a hook-based token.  Used only for
///      Test-D; does NOT inherit MockERC20 so we avoid virtual/override issues.
contract CallbackERC20 {
    string  public name     = "Callback USDC";
    string  public symbol   = "cbUSDC";
    uint8   public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        totalSupply     += amount;
        balanceOf[to]   += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @dev Identical to MockERC20.transfer EXCEPT it fires onERC20Received
    ///      on the recipient if it is a contract.  This creates the reentrant
    ///      call-path into Quincena.withdraw().
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);

        // Fire callback if `to` has code (i.e. is a contract).
        uint256 size;
        assembly { size := extcodesize(to) }
        if (size > 0) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok,) = to.call(abi.encodeWithSignature("onERC20Received(uint256)", amount));
            (ok); // suppress "unused return value" warning; callback reverts are intentional
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount,            "MockERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "MockERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev Attacker contract: calls `quincena.withdraw()` a second time from
///      inside the ERC-20 transfer callback.  The second call must revert with
///      ReentrancyGuardReentrantCall because nonReentrant locks on first entry.
contract ReentrantWithdrawer {
    Quincena public immutable quincena;
    bool public reentered;
    bytes public revertData;

    constructor(Quincena _quincena) {
        quincena = _quincena;
    }

    /// First withdrawal — called by the test.
    function attackWithdraw() external {
        quincena.withdraw();
    }

    /// ERC-20 transfer hook — triggered by CallbackERC20.transfer().
    /// At this point we are still inside quincena.withdraw() (nonReentrant locked).
    function onERC20Received(uint256) external {
        reentered = true;
        try quincena.withdraw() {
            // Should not reach here.
        } catch (bytes memory data) {
            revertData = data;
        }
    }
}

contract QuincenaTest is Test {
    // ── constants ────────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_CHAIN_ID = 5042002;

    // ── actors ───────────────────────────────────────────────────────────────
    address internal client  = makeAddr("client");
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    // ── contracts ────────────────────────────────────────────────────────────
    Quincena  internal quincena;
    MockERC20 internal usdc;

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public {
        // 1. Override chain-id so constructor passes the WrongChain() guard.
        vm.chainId(ARC_CHAIN_ID);

        // 2. Deploy a MockERC20 then etch its bytecode onto the canonical USDC address.
        MockERC20 impl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(impl).code);
        usdc = MockERC20(USDC_ADDR);

        // 3. Deploy the contract under test (chain-id check passes now).
        quincena = new Quincena();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Mint `amount` USDC to `to` and approve the contract to spend it.
    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        vm.prank(to);
        usdc.approve(address(quincena), amount);
    }

    /// Build a single-payee stream (alice, 10 000 bps).
    function _createSinglePayeeStream(
        uint256 amountPerPeriod,
        uint32  periodSeconds,
        uint16  periods,
        uint32  cancelNoticePeriods
    ) internal returns (uint256 streamId) {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        uint256 totalFunding = amountPerPeriod * uint256(periods);
        _fund(client, totalFunding);

        vm.prank(client);
        quincena.createStream(payees, bps, amountPerPeriod, periodSeconds, periods, cancelNoticePeriods, "test");
        streamId = 0; // first stream
    }

    /// Build a 3-payee stream (alice/bob/carol, custom bps — must sum to 10 000).
    function _createThreePayeeStream(
        uint16[3] memory payeeBps,
        uint256 amountPerPeriod,
        uint32  periodSeconds,
        uint16  periods,
        uint32  cancelNoticePeriods
    ) internal returns (uint256 streamId) {
        address[] memory payees = new address[](3);
        payees[0] = alice;
        payees[1] = bob;
        payees[2] = carol;
        uint16[] memory bpsArr = new uint16[](3);
        bpsArr[0] = payeeBps[0];
        bpsArr[1] = payeeBps[1];
        bpsArr[2] = payeeBps[2];

        uint256 totalFunding = amountPerPeriod * uint256(periods);
        _fund(client, totalFunding);

        vm.prank(client);
        quincena.createStream(payees, bpsArr, amountPerPeriod, periodSeconds, periods, cancelNoticePeriods, "3pay");
        streamId = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-1  Full payout over all periods
    // ─────────────────────────────────────────────────────────────────────────
    /// @notice Create a 3-period stream, advance through all periods, claim,
    ///         then withdraw — payee should receive amountPerPeriod * periods.
    function test_FullPayoutAllPeriods() public {
        uint256 amountPerPeriod = 1_000e6; // 1 000 USDC (6 dec)
        uint32  periodSeconds   = 30 days;
        uint16  periods         = 3;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        // Advance past all 3 periods.
        vm.warp(block.timestamp + uint256(periodSeconds) * periods + 1);

        // Claim (anyone can call).
        quincena.claim(streamId);

        // Verify pendingWithdrawal accumulated.
        uint256 expected = amountPerPeriod * periods;
        assertEq(quincena.pendingWithdrawal(alice), expected, "pending should equal total payout");

        // Alice withdraws.
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        quincena.withdraw();
        uint256 balAfter = usdc.balanceOf(alice);

        assertEq(balAfter - balBefore, expected, "alice balance delta should equal total payout");
        assertEq(quincena.pendingWithdrawal(alice), 0, "pending should be zero after withdraw");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-2  3-payee split with rounding
    // ─────────────────────────────────────────────────────────────────────────
    /// @notice 3334 / 3333 / 3333 bps, amountPerPeriod = 10.
    ///         floor(10 * 3334/10000) = 3, floor(10 * 3333/10000) = 3 (both).
    ///         Last payee (carol) is the remainder bucket: 10 - 3 - 3 = 4.
    function test_ThreePayeeSplitWithRounding() public {
        uint256 amountPerPeriod = 10;
        uint32  periodSeconds   = 100;
        uint16  periods         = 1;

        uint16[3] memory bps = [uint16(3334), uint16(3333), uint16(3333)];
        uint256 streamId = _createThreePayeeStream(bps, amountPerPeriod, periodSeconds, periods, 0);

        // Advance exactly one period.
        vm.warp(block.timestamp + periodSeconds);

        quincena.claim(streamId);

        // alice: floor(10 * 3334 / 10000) = floor(3.334) = 3
        assertEq(quincena.pendingWithdrawal(alice), 3,  "alice should get 3");
        // bob:   floor(10 * 3333 / 10000) = floor(3.333) = 3
        assertEq(quincena.pendingWithdrawal(bob),   3,  "bob should get 3");
        // carol: remainder = 10 - 3 - 3 = 4
        assertEq(quincena.pendingWithdrawal(carol), 4,  "carol should get 4");

        // Seed the contract with tokens so withdraw() can succeed.
        // (contract already received them via createStream transferFrom)

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);  quincena.withdraw();
        assertEq(usdc.balanceOf(alice) - aliceBefore, 3, "alice withdrew 3");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);    quincena.withdraw();
        assertEq(usdc.balanceOf(bob) - bobBefore,     3, "bob withdrew 3");

        uint256 carolBefore = usdc.balanceOf(carol);
        vm.prank(carol);  quincena.withdraw();
        assertEq(usdc.balanceOf(carol) - carolBefore, 4, "carol withdrew 4");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-3  Cancel with notice period
    // ─────────────────────────────────────────────────────────────────────────
    /// @notice periodSeconds=100, cancelNoticePeriods=2, periods=10.
    ///         Advance 150 s (1.5 periods elapsed).
    ///         cutoffPeriod = (150 + 2*100) / 100 = 350/100 = 3 (integer div).
    ///         refundPeriods = 10 - 3 = 7.
    ///         refundAmount  = 7 * amountPerPeriod.
    function test_CancelWithNoticePeriod() public {
        uint256 amountPerPeriod = 100;
        uint32  periodSeconds   = 100;
        uint16  periods         = 10;
        uint32  cancelNoticePeriods = 2;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, cancelNoticePeriods);

        uint256 clientBalBefore = usdc.balanceOf(client);

        // Advance 150 seconds.
        vm.warp(block.timestamp + 150);

        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(quincena));
        emit Quincena.StreamCancelled(streamId, 3, 7 * amountPerPeriod);
        quincena.cancel(streamId);

        uint256 refundReceived = usdc.balanceOf(client) - clientBalBefore;
        assertEq(refundReceived, 7 * amountPerPeriod, "client refund should be 7 periods");

        // Only 3 periods remain claimable.
        (uint256 claimableAmt, uint256 claimablePeriods) = quincena.claimable(streamId);
        assertEq(claimablePeriods, 1, "only period 0 unlocked (150s < 200s for period 2)");
        // After cancel, unlockedPeriods is capped at cancelledAtPeriod=3,
        // and elapsed = 150s → floor(150/100)=1 unlocked period, so claimable = 1 period.
        assertEq(claimableAmt, 1 * amountPerPeriod, "claimable amount should be 1 period");

        // Verify stream is marked cancelled.
        Quincena.Stream memory s = quincena.getStream(streamId);
        assertTrue(s.cancelled, "stream should be cancelled");
        assertEq(s.cancelledAtPeriod, 3, "cancelledAtPeriod should be 3");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-4  Claim before any period unlocks → nothing accrues
    // ─────────────────────────────────────────────────────────────────────────
    function test_ClaimBeforeUnlock() public {
        uint256 amountPerPeriod = 500e6;
        uint32  periodSeconds   = 7 days;
        uint16  periods         = 5;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        // Do NOT advance time — claim immediately.
        quincena.claim(streamId);

        assertEq(quincena.pendingWithdrawal(alice), 0, "nothing should accrue before unlock");

        // periodsClaimedCount should still be 0.
        Quincena.Stream memory s = quincena.getStream(streamId);
        assertEq(s.periodsClaimedCount, 0, "periodsClaimedCount should remain 0");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-5  Non-client cancel reverts with NotStreamClient
    // ─────────────────────────────────────────────────────────────────────────
    function test_NonClientCancelReverts() public {
        uint256 streamId = _createSinglePayeeStream(100e6, 30 days, 3, 0);

        vm.prank(stranger);
        vm.expectRevert(Quincena.NotStreamClient.selector);
        quincena.cancel(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-6  Double-claim protection — second claim at same block adds nothing
    // ─────────────────────────────────────────────────────────────────────────
    function test_DoubleClaimProtection() public {
        uint256 amountPerPeriod = 200e6;
        uint32  periodSeconds   = 7 days;
        uint16  periods         = 5;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        // Advance exactly 1 period.
        vm.warp(block.timestamp + periodSeconds);

        // First claim.
        quincena.claim(streamId);
        uint256 pendingAfterFirst = quincena.pendingWithdrawal(alice);
        assertEq(pendingAfterFirst, amountPerPeriod, "first claim: 1 period worth");

        // Second claim at same timestamp — no new periods unlocked.
        quincena.claim(streamId);
        uint256 pendingAfterSecond = quincena.pendingWithdrawal(alice);
        assertEq(pendingAfterSecond, pendingAfterFirst, "second claim should add nothing");

        // Verify periodsClaimedCount is still 1.
        Quincena.Stream memory s = quincena.getStream(streamId);
        assertEq(s.periodsClaimedCount, 1, "periodsClaimedCount should be 1");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TC-7  Claim with maxPeriods bound
    // ─────────────────────────────────────────────────────────────────────────
    /// @notice 5-period stream, advance past all 5.
    ///         claim(id, 2) → 2 periods. claim(id, 2) → 2 more. claim(id, 0) → last 1.
    function test_ClaimWithMaxPeriodsBound() public {
        uint256 amountPerPeriod = 100e6;
        uint32  periodSeconds   = 1 days;
        uint16  periods         = 5;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        // Advance past all 5 periods.
        vm.warp(block.timestamp + uint256(periodSeconds) * periods + 1);

        // --- Batch 1: claim 2 periods ---
        quincena.claim(streamId, 2);
        assertEq(quincena.pendingWithdrawal(alice), 2 * amountPerPeriod, "after batch-1: 2 periods");
        {
            Quincena.Stream memory s = quincena.getStream(streamId);
            assertEq(s.periodsClaimedCount, 2, "periodsClaimedCount should be 2 after batch-1");
        }

        // --- Batch 2: claim 2 more ---
        quincena.claim(streamId, 2);
        assertEq(quincena.pendingWithdrawal(alice), 4 * amountPerPeriod, "after batch-2: 4 periods");
        {
            Quincena.Stream memory s = quincena.getStream(streamId);
            assertEq(s.periodsClaimedCount, 4, "periodsClaimedCount should be 4 after batch-2");
        }

        // --- Batch 3: claim remaining 1 (maxPeriods=0 means no cap) ---
        quincena.claim(streamId, 0);
        assertEq(quincena.pendingWithdrawal(alice), 5 * amountPerPeriod, "after batch-3: 5 periods total");
        {
            Quincena.Stream memory s = quincena.getStream(streamId);
            assertEq(s.periodsClaimedCount, 5, "periodsClaimedCount should be 5 after batch-3");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: deployment / initialization
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice USDC constant resolves to the canonical address.
    function test_USDCConstant() public view {
        assertEq(address(quincena.USDC()), USDC_ADDR, "USDC constant should be the Arc address");
    }

    /// @notice Constructor reverts with WrongChain on a different chain-id.
    function test_WrongChainReverts() public {
        vm.chainId(1); // Ethereum mainnet
        vm.expectRevert(Quincena.WrongChain.selector);
        new Quincena();
        // Restore for any subsequent tests (setUp resets state anyway).
        vm.chainId(ARC_CHAIN_ID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: createStream validation reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_CreateStream_InvalidBpsTotal_Reverts() public {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 9_999; // not 10 000

        _fund(client, 1_000e6);
        vm.prank(client);
        vm.expectRevert(Quincena.InvalidBpsTotal.selector);
        quincena.createStream(payees, bps, 1_000e6, 7 days, 1, 0, "bad bps");
    }

    function test_CreateStream_ZeroAddress_Reverts() public {
        address[] memory payees = new address[](1);
        payees[0] = address(0);
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        _fund(client, 1_000e6);
        vm.prank(client);
        vm.expectRevert(Quincena.ZeroAddressPayee.selector);
        quincena.createStream(payees, bps, 1_000e6, 7 days, 1, 0, "zero payee");
    }

    function test_CreateStream_TooManyPayees_Reverts() public {
        // 6 payees exceeds the max of 5.
        address[] memory payees = new address[](6);
        uint16[] memory bps     = new uint16[](6);
        for (uint256 i = 0; i < 6; i++) {
            payees[i] = makeAddr(string(abi.encodePacked("p", i)));
            bps[i]    = 1_666;
        }
        bps[5] = 1_670; // adjust to reach 10 000 (5*1666+1670=10000)

        _fund(client, 6_000e6);
        vm.prank(client);
        vm.expectRevert(Quincena.InvalidPayeeCount.selector);
        quincena.createStream(payees, bps, 1_000e6, 7 days, 1, 0, "too many");
    }

    function test_CreateStream_ZeroAmountPerPeriod_Reverts() public {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        vm.prank(client);
        vm.expectRevert(Quincena.InvalidAmountPerPeriod.selector);
        quincena.createStream(payees, bps, 0, 7 days, 1, 0, "zero amount");
    }

    function test_CreateStream_ZeroPeriods_Reverts() public {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        _fund(client, 1_000e6);
        vm.prank(client);
        vm.expectRevert(Quincena.InvalidPeriods.selector);
        quincena.createStream(payees, bps, 1_000e6, 7 days, 0, 0, "zero periods");
    }

    function test_CreateStream_ZeroPeriodSeconds_Reverts() public {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        _fund(client, 1_000e6);
        vm.prank(client);
        vm.expectRevert(Quincena.InvalidPeriodSeconds.selector);
        quincena.createStream(payees, bps, 1_000e6, 0, 1, 0, "zero period seconds");
    }

    function test_CreateStream_MismatchedArrayLengths_Reverts() public {
        address[] memory payees = new address[](2);
        payees[0] = alice;
        payees[1] = bob;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        _fund(client, 1_000e6);
        vm.prank(client);
        vm.expectRevert(Quincena.InvalidArrayLengths.selector);
        quincena.createStream(payees, bps, 1_000e6, 7 days, 1, 0, "mismatch");
    }

    function test_CreateStream_PeriodsTooHigh_Reverts() public {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        // _validateCreateParams checks periods > MAX_PERIODS (1 000) before any
        // token transfer, so we do NOT need to pre-fund for 1 001 periods.
        // Fund only enough to satisfy the approve path without overflowing.
        uint256 amountPerPeriod = 1e6; // small amount
        uint16  tooPeriods      = 1_001;
        _fund(client, amountPerPeriod * uint256(tooPeriods));
        vm.prank(client);
        vm.expectRevert(Quincena.PeriodsTooHigh.selector);
        quincena.createStream(payees, bps, amountPerPeriod, 7 days, tooPeriods, 0, "too many periods");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: withdraw reverts when nothing pending
    // ─────────────────────────────────────────────────────────────────────────

    function test_Withdraw_NothingToWithdraw_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(Quincena.NothingToWithdraw.selector);
        quincena.withdraw();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: StreamNotFound reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_Claim_StreamNotFound_Reverts() public {
        vm.expectRevert(Quincena.StreamNotFound.selector);
        quincena.claim(999);
    }

    function test_Cancel_StreamNotFound_Reverts() public {
        vm.prank(client);
        vm.expectRevert(Quincena.StreamNotFound.selector);
        quincena.cancel(999);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: double-cancel reverts with StreamAlreadyCancelled
    // ─────────────────────────────────────────────────────────────────────────

    function test_DoubleCancel_Reverts() public {
        uint256 streamId = _createSinglePayeeStream(100e6, 7 days, 3, 0);

        vm.prank(client);
        quincena.cancel(streamId);

        vm.prank(client);
        vm.expectRevert(Quincena.StreamAlreadyCancelled.selector);
        quincena.cancel(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: StreamCreated event emitted on createStream
    // ─────────────────────────────────────────────────────────────────────────

    function test_CreateStream_EmitsStreamCreated() public {
        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        uint256 amountPerPeriod = 500e6;
        uint16  periods         = 2;
        uint32  periodSeconds   = 7 days;

        _fund(client, amountPerPeriod * periods);

        vm.prank(client);
        vm.expectEmit(true, true, false, true, address(quincena));
        emit Quincena.StreamCreated(0, client, amountPerPeriod, periods, periodSeconds);
        quincena.createStream(payees, bps, amountPerPeriod, periodSeconds, periods, 0, "event test");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: PeriodPaid event emitted during claim
    // ─────────────────────────────────────────────────────────────────────────

    function test_Claim_EmitsPeriodPaid() public {
        uint256 amountPerPeriod = 1_000e6;
        uint32  periodSeconds   = 7 days;
        uint16  periods         = 2;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        vm.warp(block.timestamp + periodSeconds);

        vm.expectEmit(true, true, false, true, address(quincena));
        emit Quincena.PeriodPaid(streamId, 0, amountPerPeriod);
        quincena.claim(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: Withdrawn event emitted on withdraw
    // ─────────────────────────────────────────────────────────────────────────

    function test_Withdraw_EmitsWithdrawn() public {
        uint256 amountPerPeriod = 1_000e6;
        uint32  periodSeconds   = 7 days;
        uint16  periods         = 1;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        vm.warp(block.timestamp + periodSeconds);
        quincena.claim(streamId);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(quincena));
        emit Quincena.Withdrawn(alice, amountPerPeriod);
        quincena.withdraw();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: streamsOfClient / streamsOfPayee indices
    // ─────────────────────────────────────────────────────────────────────────

    function test_StreamIndexing() public {
        _createSinglePayeeStream(100e6, 7 days, 1, 0);

        uint256[] memory clientStreams = quincena.streamsOfClient(client);
        assertEq(clientStreams.length, 1, "client should have 1 stream");
        assertEq(clientStreams[0],     0, "stream id should be 0");

        uint256[] memory aliceStreams = quincena.streamsOfPayee(alice);
        assertEq(aliceStreams.length, 1, "alice should be payee of 1 stream");
        assertEq(aliceStreams[0],     0, "stream id should be 0");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: claimable() view reflects unclaimed periods
    // ─────────────────────────────────────────────────────────────────────────

    function test_Claimable_ReflectsUnclaimedPeriods() public {
        uint256 amountPerPeriod = 100e6;
        uint32  periodSeconds   = 7 days;
        uint16  periods         = 5;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 0);

        // Advance 3 periods.
        vm.warp(block.timestamp + uint256(periodSeconds) * 3);

        (uint256 amount, uint256 numP) = quincena.claimable(streamId);
        assertEq(numP,   3,                     "3 periods unlocked");
        assertEq(amount, 3 * amountPerPeriod,   "claimable amount = 3 * amountPerPeriod");

        // After claiming, claimable drops to 0.
        quincena.claim(streamId);
        (uint256 amount2, uint256 numP2) = quincena.claimable(streamId);
        assertEq(numP2,   0, "nothing left after claim");
        assertEq(amount2, 0, "claimable amount is 0 after claim");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: cancel capped at stream.periods (no over-shoot)
    // ─────────────────────────────────────────────────────────────────────────

    function test_CancelAfterAllPeriodsNeverOvershoot() public {
        uint256 amountPerPeriod = 200e6;
        uint32  periodSeconds   = 7 days;
        uint16  periods         = 3;

        uint256 streamId = _createSinglePayeeStream(amountPerPeriod, periodSeconds, periods, 10);

        // Advance past ALL periods.
        vm.warp(block.timestamp + uint256(periodSeconds) * periods + 1);

        uint256 clientBalBefore = usdc.balanceOf(client);

        vm.prank(client);
        quincena.cancel(streamId);

        // cutoffPeriod should be capped at stream.periods (3), so refund = 0.
        uint256 refund = usdc.balanceOf(client) - clientBalBefore;
        assertEq(refund, 0, "no refund when cancel is called after all periods elapsed");

        Quincena.Stream memory s = quincena.getStream(streamId);
        assertEq(s.cancelledAtPeriod, periods, "cancelledAtPeriod capped at stream.periods");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: any valid single-payee stream can be created, claimed, withdrawn
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_CreateClaimWithdraw(
        uint32 periodSeconds,
        uint8  periods,
        uint64 amountPerPeriod
    ) public {
        // Bound inputs to valid ranges.
        periodSeconds   = uint32(bound(periodSeconds,   1,       365 days));
        periods         = uint8(bound(periods,           1,       100));      // stay well under MAX_PERIODS
        amountPerPeriod = uint64(bound(amountPerPeriod, 1,       1_000_000e6));

        address[] memory payees = new address[](1);
        payees[0] = alice;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        uint256 totalFunding = uint256(amountPerPeriod) * uint256(periods);
        _fund(client, totalFunding);

        vm.prank(client);
        quincena.createStream(payees, bps, amountPerPeriod, periodSeconds, periods, 0, "fuzz");

        // Advance past all periods.
        vm.warp(block.timestamp + uint256(periodSeconds) * uint256(periods) + 1);

        quincena.claim(0);

        uint256 expected = uint256(amountPerPeriod) * uint256(periods);
        assertEq(quincena.pendingWithdrawal(alice), expected, "fuzz: pending should equal total");

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        quincena.withdraw();
        assertEq(usdc.balanceOf(alice) - balBefore, expected, "fuzz: withdraw should equal total");
    }

    // =========================================================================
    // Security-fix tests (added)
    // =========================================================================

    // ─────────────────────────────────────────────────────────────────────────
    // Test A: payee == client reverts with PayeeIsClient
    // Fix #3: _validateCreateParams now rejects payees[i] == msg.sender.
    // ─────────────────────────────────────────────────────────────────────────
    function test_PayeeEqualsClientReverts() public {
        // Build a 1-payee stream where the payee IS the client.
        address[] memory payees = new address[](1);
        payees[0] = client;          // <-- client trying to pay themselves
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        _fund(client, 100e6);

        vm.prank(client);
        vm.expectRevert(Quincena.PayeeIsClient.selector);
        quincena.createStream(payees, bps, 100e6, 7 days, 1, 0, "payee==client");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test A (multi-payee variant): payee == client anywhere in the list reverts
    // ─────────────────────────────────────────────────────────────────────────
    function test_PayeeEqualsClientReverts_MultiPayee() public {
        // 2-payee stream: alice (fine) + client (invalid)
        address[] memory payees = new address[](2);
        payees[0] = alice;
        payees[1] = client;          // second payee is the client
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        _fund(client, 200e6);

        vm.prank(client);
        vm.expectRevert(Quincena.PayeeIsClient.selector);
        quincena.createStream(payees, bps, 100e6, 7 days, 2, 0, "payee==client multi");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test B: duplicate payee address reverts with DuplicatePayee
    // Fix #4: _validateCreateParams O(n²) inner loop catches duplicates.
    // ─────────────────────────────────────────────────────────────────────────
    function test_DuplicatePayeeReverts() public {
        // Both payees are alice — this must revert.
        address[] memory payees = new address[](2);
        payees[0] = alice;
        payees[1] = alice;           // duplicate
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        _fund(client, 200e6);

        vm.prank(client);
        vm.expectRevert(Quincena.DuplicatePayee.selector);
        quincena.createStream(payees, bps, 100e6, 7 days, 2, 0, "dup payee");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test B (3-payee variant): duplicate in non-adjacent positions reverts
    // ─────────────────────────────────────────────────────────────────────────
    function test_DuplicatePayeeReverts_NonAdjacent() public {
        // payees = [alice, bob, alice] — alice appears at index 0 and 2.
        address[] memory payees = new address[](3);
        payees[0] = alice;
        payees[1] = bob;
        payees[2] = alice;           // duplicate with index 0
        uint16[] memory bps = new uint16[](3);
        bps[0] = 4_000;
        bps[1] = 4_000;
        bps[2] = 2_000;

        _fund(client, 300e6);

        vm.prank(client);
        vm.expectRevert(Quincena.DuplicatePayee.selector);
        quincena.createStream(payees, bps, 100e6, 7 days, 3, 0, "dup non-adj");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test C: cancel refund arithmetic is correct in three ordering scenarios.
    // Fix #2: refund uses max(cutoffPeriod, periodsClaimedCount) as the floor.
    //
    // C1 — cancel before any claim.
    //   10 periods, periodSeconds=100, notice=2.
    //   Warp 150 s → elapsed=150, cutoffPeriod=(150+200)/100=3.
    //   paidOrLocked = max(3, 0) = 3. refund = 7 * amountPerPeriod.
    // ─────────────────────────────────────────────────────────────────────────
    function test_CancelBeforeClaims_CorrectRefund() public {
        uint256 amountPerPeriod   = 100e6;
        uint32  periodSeconds     = 100;
        uint16  periods           = 10;
        uint32  cancelNoticePeriods = 2;

        uint256 streamId = _createSinglePayeeStream(
            amountPerPeriod, periodSeconds, periods, cancelNoticePeriods
        );

        uint256 clientBalBefore = usdc.balanceOf(client);

        // Advance 150 s (1.5 periods elapsed).
        vm.warp(block.timestamp + 150);

        // cutoffPeriod = (150 + 200) / 100 = 3 (integer div).
        // paidOrLocked = max(3, 0) = 3.
        // refundPeriods = 10 - 3 = 7. refundAmount = 700e6.
        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(quincena));
        emit Quincena.StreamCancelled(streamId, 3, 7 * amountPerPeriod);
        quincena.cancel(streamId);

        uint256 refund = usdc.balanceOf(client) - clientBalBefore;
        assertEq(refund, 7 * amountPerPeriod, "C1: refund should be 7 periods");

        // periodsClaimedCount untouched (no claim was made).
        Quincena.Stream memory s = quincena.getStream(streamId);
        assertEq(s.periodsClaimedCount, 0, "C1: periodsClaimedCount should still be 0");
        assertEq(s.cancelledAtPeriod,   3, "C1: cancelledAtPeriod should be 3");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C2 — claim first, then cancel at the same timestamp.
    //   10 periods, periodSeconds=100, notice=0.
    //   Warp 500 s → 5 periods unlocked.
    //   claim() → periodsClaimedCount=5.
    //   cancel() at t=500: cutoffPeriod=500/100=5.
    //   paidOrLocked = max(5, 5) = 5. refund = 5 * amountPerPeriod.
    //
    //   Defensive aspect: even though periodsClaimedCount == cutoffPeriod here,
    //   the max() ensures correctness. Alice can still withdraw her 5 periods.
    // ─────────────────────────────────────────────────────────────────────────
    function test_CancelAfterClaims_CorrectRefund() public {
        uint256 amountPerPeriod   = 100e6;
        uint32  periodSeconds     = 100;
        uint16  periods           = 10;
        uint32  cancelNoticePeriods = 0;

        uint256 streamId = _createSinglePayeeStream(
            amountPerPeriod, periodSeconds, periods, cancelNoticePeriods
        );

        // Advance 500 s → 5 full periods elapsed.
        vm.warp(block.timestamp + 500);

        // Claim: periodsClaimedCount becomes 5, alice gets 5 * 100e6 in pendingWithdrawal.
        quincena.claim(streamId);
        assertEq(quincena.pendingWithdrawal(alice), 5 * amountPerPeriod, "C2: alice pending after claim");

        uint256 clientBalBefore = usdc.balanceOf(client);

        // Cancel at same timestamp (t=500).
        // cutoffPeriod = 500/100 = 5. paidOrLocked = max(5,5) = 5. refund = 5 * 100e6.
        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(quincena));
        emit Quincena.StreamCancelled(streamId, 5, 5 * amountPerPeriod);
        quincena.cancel(streamId);

        uint256 refund = usdc.balanceOf(client) - clientBalBefore;
        assertEq(refund, 5 * amountPerPeriod, "C2: refund should be 5 periods (remaining unfunded)");

        // Alice's pendingWithdrawal must be untouched by cancel — she earned those 5 periods.
        assertEq(quincena.pendingWithdrawal(alice), 5 * amountPerPeriod, "C2: alice pending unchanged");

        // Alice withdraws successfully.
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        quincena.withdraw();
        assertEq(usdc.balanceOf(alice) - aliceBefore, 5 * amountPerPeriod, "C2: alice withdrew correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C3 — cancel first, then claim up to the cutoff period.
    //   10 periods, periodSeconds=100, notice=2.
    //   Warp 150 s → cutoffPeriod=3, refund=7*amountPerPeriod.
    //   Then warp to 300 s (3 full periods elapsed).
    //   claim() → unlockedPeriods capped at cancelledAtPeriod=3 → claimedCount=3.
    //   Alice gets exactly 3 * amountPerPeriod. No more claimable after that.
    // ─────────────────────────────────────────────────────────────────────────
    function test_CancelThenClaim_UpToCutoff() public {
        uint256 amountPerPeriod     = 100e6;
        uint32  periodSeconds       = 100;
        uint16  periods             = 10;
        uint32  cancelNoticePeriods = 2;

        uint256 streamId = _createSinglePayeeStream(
            amountPerPeriod, periodSeconds, periods, cancelNoticePeriods
        );

        // Cancel at t=150 s → cutoffPeriod=3.
        vm.warp(block.timestamp + 150);
        vm.prank(client);
        quincena.cancel(streamId);

        Quincena.Stream memory s = quincena.getStream(streamId);
        assertEq(s.cancelledAtPeriod, 3, "C3: cancelledAtPeriod should be 3");

        // Advance to t=300 s (3 full periods have elapsed — all 3 cutoff periods unlocked).
        vm.warp(block.timestamp + 150); // total: 300 s from start

        // Claim: unlockedPeriods = min(300/100, cancelledAtPeriod=3) = min(3, 3) = 3.
        quincena.claim(streamId);
        assertEq(quincena.pendingWithdrawal(alice), 3 * amountPerPeriod, "C3: alice gets exactly 3 periods");

        {
            Quincena.Stream memory s2 = quincena.getStream(streamId);
            assertEq(s2.periodsClaimedCount, 3, "C3: periodsClaimedCount should be 3");
        }

        // A second claim adds nothing (all cutoff periods exhausted).
        quincena.claim(streamId);
        assertEq(quincena.pendingWithdrawal(alice), 3 * amountPerPeriod, "C3: second claim adds nothing");

        // Verify claimable() returns 0.
        (uint256 amt, uint256 numP) = quincena.claimable(streamId);
        assertEq(amt,  0, "C3: claimable amount is 0");
        assertEq(numP, 0, "C3: claimable periods is 0");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test D: nonReentrant on withdraw() prevents re-entrant callback attack.
    // Fix #1: claim() is external nonReentrant. withdraw() is also nonReentrant.
    //
    // We etch a CallbackERC20 (which fires onERC20Received on every transfer)
    // at the canonical USDC address, then have a ReentrantWithdrawer try to
    // call quincena.withdraw() again from inside the ERC-20 callback.
    // The second withdraw() must revert with ReentrancyGuardReentrantCall.
    // ─────────────────────────────────────────────────────────────────────────
    function test_ReentrancyGuard_WithdrawReverts() public {
        // ── 1. Replace etched MockERC20 with a CallbackERC20 at the USDC address ──
        CallbackERC20 cbImpl = new CallbackERC20();
        vm.etch(USDC_ADDR, address(cbImpl).code);
        // Re-bind the usdc handle and re-deploy quincena so it sees fresh storage.
        usdc = MockERC20(USDC_ADDR);

        vm.chainId(ARC_CHAIN_ID);
        Quincena q2 = new Quincena();

        // ── 2. Deploy the attacker contract ──
        ReentrantWithdrawer attacker = new ReentrantWithdrawer(q2);

        // ── 3. Create a stream where the attacker is the sole payee ──
        address[] memory payees = new address[](1);
        payees[0] = address(attacker);
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        uint256 amountPerPeriod = 100e6;
        uint16  periods         = 1;
        uint32  periodSeconds   = 1 days;

        usdc.mint(client, amountPerPeriod * periods);
        vm.prank(client);
        usdc.approve(address(q2), amountPerPeriod * periods);

        vm.prank(client);
        q2.createStream(payees, bps, amountPerPeriod, periodSeconds, periods, 0, "reentrant");

        // ── 4. Advance time past 1 period, claim to accrue pendingWithdrawal ──
        vm.warp(block.timestamp + periodSeconds + 1);
        q2.claim(0);
        assertEq(q2.pendingWithdrawal(address(attacker)), amountPerPeriod, "attacker has pending");

        // ── 5. Attacker calls withdraw() — triggers transfer callback → re-enters withdraw() ──
        //       The reentrant call must be caught and stored in attacker.revertData.
        attacker.attackWithdraw();

        // The re-entrant second withdraw() must have reverted (nonReentrant guard).
        assertTrue(attacker.reentered(), "callback must have been triggered");
        assertTrue(attacker.revertData().length > 0, "reentrant withdraw must have reverted");

        // Decode and check the revert selector = ReentrancyGuardReentrantCall.
        bytes4 gotSelector = bytes4(attacker.revertData());
        // OZ ReentrancyGuard custom error: ReentrancyGuardReentrantCall()
        bytes4 expectedSelector = bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        assertEq(gotSelector, expectedSelector, "D: revert must be ReentrancyGuardReentrantCall");

        // ── 6. Despite the attack, the attacker's first withdrawal succeeded ──
        //       pendingWithdrawal is now 0 (the first withdraw went through).
        assertEq(q2.pendingWithdrawal(address(attacker)), 0, "D: first withdraw cleared pending");

        // And the attacker's USDC balance equals the claimed amount.
        assertEq(usdc.balanceOf(address(attacker)), amountPerPeriod, "D: attacker received funds once");
    }
}
