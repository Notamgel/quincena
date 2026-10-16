/**
 * Quincena contract config — generated from deployment
 */
import artifact from '../contracts/out/Quincena.sol/Quincena.json'
import type { Abi } from 'viem'

export const QUINCENA_ADDRESS = '0x23159fe3cfc953c9f4f57af3163176373a788858' as const
export const QUINCENA_ABI = artifact.abi as Abi

export const ARC_TESTNET_CHAIN_ID = 5042002

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
