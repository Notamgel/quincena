/**
 * Quincena contract config
 * Supports Arc Testnet (5042002) and Arc Mainnet (5042).
 */
import artifact from '../contracts/out/Quincena.sol/Quincena.json'
import type { Abi } from 'viem'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

export const QUINCENA_ABI = artifact.abi as Abi

export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_MAINNET_CHAIN_ID  = 5042

/** Deployed contract addresses per chain. */
export const QUINCENA_ADDRESSES: Record<number, `0x${string}`> = {
  [ARC_TESTNET_CHAIN_ID]: '0x23159fe3cfc953c9f4f57af3163176373a788858',
  // TODO: replace with mainnet address after you deploy
  [ARC_MAINNET_CHAIN_ID]:  '0x0000000000000000000000000000000000000000',
}

/**
 * Return the contract address for the given chain, or testnet as fallback.
 * Returns undefined for mainnet until the placeholder is replaced.
 */
export function getQuincenaAddress(chainId: number): `0x${string}` | undefined {
  const addr = QUINCENA_ADDRESSES[chainId]
  if (!addr) return undefined
  // Placeholder address means not yet deployed
  if (addr === '0x0000000000000000000000000000000000000000') return undefined
  return addr
}

/** Whether the given chainId is a supported Quincena chain. */
export function isSupportedChain(chainId: number | undefined): boolean {
  if (!chainId) return false
  return chainId === ARC_TESTNET_CHAIN_ID || chainId === ARC_MAINNET_CHAIN_ID
}

/** Explorer link for a transaction on the given chain. */
export { buildTxExplorerUrl, buildAddressExplorerUrl }

// Stream shape as returned by getStream()
export interface StreamData {
  client: string
  payees: string[]
  bps: number[]
  amountPerPeriod: bigint
  periodSeconds: number
  periods: number
  cancelNoticePeriods: number
  memo: string
  startTime: bigint
  periodsClaimedCount: number
  cancelled: boolean
  cancelledAtPeriod: number
}
