import { useEffect } from 'react'
import { Loader2, ExternalLink, ArrowDownToLine } from 'lucide-react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { QUINCENA_ADDRESS, QUINCENA_ABI, ARC_TESTNET_CHAIN_ID } from '../quincena'
import { getUsdc } from '@/onchain-facts'
import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { Lang } from '../i18n'
import { t } from '../i18n'

const glass = {
  card: {
    background: 'rgba(255,255,255,0.64)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.68)',
    boxShadow: '0 8px 32px rgba(18,45,69,0.08), inset 0 1px 0 rgba(255,255,255,0.55)',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.52)',
    border: '1px solid rgba(255,255,255,0.60)',
  } as React.CSSProperties,
}

const usdcDecimals = usdcDecimalsFor(ARC_TESTNET_CHAIN_ID)
const fmtUsdc = (raw: bigint) => Amount.fromRaw(raw, usdcDecimals).toFixed(6)
const USDC_ADDRESS = getUsdc(ARC_TESTNET_CHAIN_ID)?.address as `0x${string}`

interface Props {
  lang: Lang
}

export function WithdrawCard({ lang }: Props) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const isWrongChain = chainId !== ARC_TESTNET_CHAIN_ID

  const { data: pending, refetch } = useReadContract({
    address: QUINCENA_ADDRESS,
    abi: QUINCENA_ABI,
    functionName: 'pendingWithdrawal',
    args: [address!],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address!],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const { writeContract: writeWithdraw, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isSuccess) {
      toast.success(t('withdrawn', lang))
      void refetch()
      void refetchBalance()
    }
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleWithdraw = () => {
    if (isWrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    writeWithdraw({
      address: QUINCENA_ADDRESS,
      abi: QUINCENA_ABI,
      functionName: 'withdraw',
      args: [],
    }, {
      onError: (e) => toast.error(e.message.includes('user rejected') ? t('txCancelled', lang) : t('withdrawFailed', lang)),
    })
  }

  const pendingRaw = (pending as bigint | undefined) ?? 0n
  const balanceRaw = (usdcBalance) ?? 0n
  const busy = isPending || isConfirming
  const txUrl = hash ? buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, hash) : null
  const hasPending = pendingRaw > 0n

  if (!address) return null

  return (
    <div className="rounded-3xl p-5" style={glass.card}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="display text-base font-bold" style={{ color: 'var(--ink)' }}>{t('payeeBalance', lang)}</h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{t('earnedWaiting', lang)}</p>
        </div>
        <div
          className="flex size-10 flex-shrink-0 items-center justify-center rounded-2xl"
          style={{ background: hasPending ? 'rgba(26,128,71,0.10)' : 'rgba(18,45,69,0.05)' }}
        >
          <ArrowDownToLine className="size-4" style={{ color: hasPending ? 'var(--success)' : 'var(--subtle)' }} />
        </div>
      </div>

      {/* Hero amount */}
      <div className="mb-3 rounded-2xl px-4 py-3" style={glass.inner}>
        <p className="mb-1 text-xs" style={{ color: 'var(--subtle)' }}>{t('claimableNow', lang)}</p>
        <div className="flex items-baseline gap-1.5">
          <span
            className="display text-3xl font-bold tabular-nums"
            style={{ color: hasPending ? 'var(--success)' : 'var(--ink)' }}
          >
            {fmtUsdc(pendingRaw)}
          </span>
          <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
      </div>

      {/* Wallet balance row */}
      <div className="mb-4 flex items-center justify-between px-1 text-xs" style={{ color: 'var(--subtle)' }}>
        <span>{t('walletBalance', lang)}</span>
        <span className="tabular-nums font-medium" style={{ color: 'var(--ink)' }}>
          {fmtUsdc(balanceRaw)} USDC
        </span>
      </div>

      {/* CTA */}
      <button
        onClick={handleWithdraw}
        disabled={busy || !hasPending}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: hasPending ? 'var(--accent)' : 'rgba(18,45,69,0.2)' }}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {isWrongChain
          ? t('switchNetwork', lang)
          : busy
          ? isConfirming ? t('confirming', lang) : t('confirmWallet', lang)
          : hasPending
          ? t('withdrawUsdc', lang)
          : t('nothingToWithdraw', lang)}
      </button>

      {txUrl && (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--accent-hover)' }}
        >
          <ExternalLink className="size-3" />
          {t('viewExplorer', lang)}
        </a>
      )}
    </div>
  )
}
