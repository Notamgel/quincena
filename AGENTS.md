# Quincena — USDC Payroll Streams

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Quincena is a USDC payroll escrow app on Arc Testnet. Clients create recurring payment streams to up to 5 payees (splits defined by basis points). Streams unlock period by period; anyone can trigger a claim (pull-payment — payees withdraw individually). Clients can cancel with notice; locked-in notice periods are protected, the rest is refunded immediately.

## Deployed Contracts

| Contract | Network | Address |
|---|---|---|
| Quincena v1 (pre-audit) | Arc Testnet | 0xfb57ed3d1b32345972295f7a837b4d122c9a5c41 |
| Quincena v2 (post-audit fixes) | Arc Testnet | 0x23159fe3cfc953c9f4f57af3163176373a788858 |
| Quincena v2 | Arc Mainnet | 0x153ace52a2cfcffad92421d365af8e31cf494e68 |

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
