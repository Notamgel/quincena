# Quincena — USDC Payroll Streams on Arc

> *Quincena* (keen-SEH-nah): Spanish for a two-week pay period. The standard cadence for
> millions of freelancers and contractors across Latin America.

---

## The Problem

Contractors and freelancers across LATAM face two structural problems with cross-border payroll:

1. **Late payments.** Traditional wire transfers clear in 3–5 business days, cross multiple
   correspondent banks, and fail silently if an intermediary rejects the payment. A client
   in the US paying a contractor in Mexico City often means the contractor waits a week after
   the invoice is sent — and has no visibility into why.

2. **Expensive payments.** SWIFT fees, FX spread, and intermediary bank charges can consume
   5–8% of a small payment. A $500 quincena becomes $460 by the time it lands.

Stablecoins remove both problems: USDC settles in seconds, carries negligible fees, and needs
no correspondent bank. But sending a manual USDC transfer every two weeks still requires the
client to remember, have funds ready, and execute. One missed wallet interaction breaks the
whole arrangement.

**Quincena automates the commitment.** A client locks up the agreed USDC upfront, and the
contract releases it on schedule — period by period, split by agreed percentages — without
the client needing to do anything after setup. The contractor can see exactly what is owed,
when the next unlock happens, and can pull their share any time.

---

## How It Works

```
Client                     Quincena.sol                   Payees
  │                              │                           │
  │  createStream(payees, %, ...) │                           │
  │  + approve 1 USDC            │                           │
  │ ──────────────────────────── ▶  escrow locked           │
  │                              │                           │
  │                           t=2min                         │
  │                              │  Period 0 unlocks         │
  │                              │                           │
  │                    anyone can call claim()               │
  │                              │  pendingWithdrawal[A] += 70%
  │                              │  pendingWithdrawal[B] += 30%
  │                              │                           │
  │                              │         ◀── withdraw() ── │
  │                              │  USDC transferred to payee│
```

1. **Create a stream** — the client deposits `amountPerPeriod × periods` USDC and specifies
   up to 5 payees with percentage splits. A notice period determines how many periods lock in
   if the client cancels early.

2. **Periods unlock automatically** — every `periodSeconds` seconds, one period becomes
   claimable. Anyone can call `claim()` to process unlocked periods; the amounts accumulate
   in each payee's on-chain balance (pull-payment pattern).

3. **Payees withdraw on their own schedule** — no gas dependency on the client; one payee's
   bad address cannot block another's funds.

4. **Cancel with notice** — the client can cancel at any time. Periods already inside the
   notice window are protected (payees keep them); everything beyond is refunded to the
   client immediately.

---

## Contract API

**Deployed on Arc Testnet:**
`0x23159fe3cfc953c9f4f57af3163176373a788858`
[View on Arc Testnet Explorer](https://explorer.testnet.arc.io/address/0x23159fe3cfc953c9f4f57af3163176373a788858)

**Mainnet address:** `— not yet deployed —`

### Write functions

```solidity
// Create a new payment stream. Caller must have approved amountPerPeriod * periods USDC.
function createStream(
    address[] calldata payees,         // 1–5 payee addresses (no duplicates, not the caller)
    uint16[]  calldata bps,            // basis points per payee (must sum to 10 000)
    uint256            amountPerPeriod, // USDC (6 decimals) released per period
    uint32             periodSeconds,   // length of one period in seconds
    uint16             periods,         // total number of periods (max 1 000)
    uint32             cancelNoticePeriods, // notice required before cancellation takes effect
    string  calldata   memo             // free-text label (e.g. "Nov 2026 quincena")
) external;

// Process unlocked periods for a stream. Permissionless — anyone can trigger.
// Accrues each payee's share into pendingWithdrawal[payee].
function claim(uint256 streamId) external;
function claim(uint256 streamId, uint256 maxPeriods) external; // bounded variant

// Pull earned USDC to msg.sender.
function withdraw() external;

// Cancel a stream. Client only. Refunds unearned periods immediately.
function cancel(uint256 streamId) external;
```

### Read functions

```solidity
function getStream(uint256 streamId)  external view returns (Stream memory);
function claimable(uint256 streamId)  external view returns (uint256 amount, uint256 numPeriods);
function streamsOfClient(address)     external view returns (uint256[] memory);
function streamsOfPayee(address)      external view returns (uint256[] memory);
function pendingWithdrawal(address)   external view returns (uint256);
```

### Events

```solidity
event StreamCreated(uint256 indexed streamId, address indexed client,
                    uint256 amountPerPeriod, uint16 periods, uint32 periodSeconds);
event PeriodPaid(uint256 indexed streamId, uint256 indexed periodIndex, uint256 total);
event StreamCancelled(uint256 indexed streamId, uint256 cutoffPeriod, uint256 refundAmount);
event Withdrawn(address indexed payee, uint256 amount);
```

### Design decisions

| Decision | Rationale |
|---|---|
| Pull-payment (`pendingWithdrawal`) | One reverted payee transfer cannot block the rest |
| `nonReentrant` on external `claim` + `withdraw` | Guards are at the entry point; modifier on an `internal` function is a no-op |
| Refund = `(periods − max(cutoffPeriod, periodsClaimedCount)) × amountPerPeriod` | Prevents over-refunding amounts already distributed to `pendingWithdrawal` |
| `payees[i] != msg.sender` | Blocks client from listing themselves as payee to double-recover |
| Duplicate payee check (O(n²), max 5 payees) | Prevents double-allocation to one address |
| Arc Testnet chain-ID guard in constructor | Stops the bytecode being re-deployed on a chain where `0x3600…0000` is not USDC |
| Max 1 000 periods, bounded `claim(id, maxPeriods)` | Bounds gas per call; prevents stuck streams |

---

## Security review summary

Two rounds of automated analysis + manual review before deployment:

| Finding | Severity | Status |
|---|---|---|
| `nonReentrant` on internal `_claim` — modifier never fired on external calls | High | Fixed |
| Cancel could over-refund amounts already in `pendingWithdrawal` | High | Fixed |
| Payee equal to client — double recovery via refund + withdraw | Medium | Fixed |
| Duplicate payee — double bps allocation to same address | Medium | Fixed |
| Hardcoded USDC address — Arc-only by design; chain-ID guard added | Info | Acknowledged |

**36 / 36 tests pass** including fuzz (256 runs), reentrancy attack simulation, and all
cancellation orderings.

---

## Built with Arc Studio

### Contracts (`contracts/`)

Written in Solidity 0.8.28 with OpenZeppelin 5 (`SafeERC20`, `ReentrancyGuard`).
Compiled and tested with Foundry.

```bash
forge build          # compile
forge test -vv       # run all 36 tests
```

Two parallel security audits (rule-corpus + functional) were run on each iteration,
findings fed back to the contract writer, and a clean round confirmed before deployment.

### Tests (`contracts/test/Quincena.t.sol`)

36 tests covering:

- Full payout over all periods
- 3-payee bps split with remainder routing to last payee
- Cancel with notice: correct cutoff, correct refund, payees protected
- Claim before unlock (no-op)
- Non-client cancel revert
- Double-claim protection (idempotent `periodsClaimedCount`)
- Bounded `claim(id, maxPeriods)` chunked processing
- `PayeeIsClient` revert
- `DuplicatePayee` revert
- Reentrancy attack on `withdraw()` via callback ERC-20
- Fuzz: randomised `createStream → claim → withdraw` lifecycle

### Frontend (`src/`)

React 18 + Vite + TypeScript + Tailwind CSS + wagmi v2 + ConnectKit.

- **Paying tab** — create streams (percentage inputs → bps), progress bars, Cancel button
- **Receiving tab** — streams where connected wallet is a payee, live countdown to next unlock, Claim button
- **Withdraw card** — persistent earned-balance display, one-click pull with explorer link
- **EN / ES toggle** — full bilingual label set on every string in the app
- All amounts displayed at 6 USDC decimals
- Every transaction surfaces an Arc Testnet explorer link

---

## Running locally

```bash
# Prerequisites: Node 20+, Bun, Foundry

bun install
bun run dev          # Vite dev server on http://localhost:5173

forge build          # compile contracts
forge test -vv       # run tests
```

Connect MetaMask to **Arc Testnet** (Chain ID 5042002) and get test USDC from the
[Arc faucet](https://faucet.circle.com) or the **Get test USDC** button in Arc Studio.

---

## Future work

### EURC / FX rails

Today a client pays in USDC and the payee receives USDC. Many LATAM contractors prefer
their local currency. The next iteration integrates **Circle's CCTP** and a DEX aggregator
so the client deposits USDC, the contract bridges via CCTP to the payee's preferred chain,
and an on-chain FX swap converts to EURC or a local stablecoin at settlement time.

### AI agent — recurring invoice autopilot

A lightweight AI agent monitors a contractor's invoicing tool (Bonsai, FreshBooks, or a
simple Telegram command), reads due dates and amounts, calls `createStream` on their behalf
using a **Circle developer-controlled wallet**, and posts a receipt back in chat. The agent
holds no private key — Circle's MPC infrastructure signs on its behalf, and the agent's
spending is capped by a policy set at wallet creation time. The full payment lifecycle
(invoice → approval → stream → claim) becomes a one-message interaction.

### Circle Wallets onboarding

The current frontend requires MetaMask. Many LATAM contractors are not yet crypto-native.
The next onboarding layer uses **Circle Modular Wallets** (passkey-based, no seed phrase)
so a contractor can sign in with Face ID on their phone, see their pending payroll balance,
and withdraw — no browser extension, no mnemonic backup.

---

## License

MIT
