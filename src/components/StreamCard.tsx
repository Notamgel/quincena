import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Clock, Users, AlertCircle, Loader2, ExternalLink, Timer } from 'lucide-react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi'
import { toast } from 'sonner'
import { QUINCENA_ADDRESS, QUINCENA_ABI, ARC_TESTNET_CHAIN_ID, type StreamData } from '../quincena'
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

function fmtUsdc(raw: bigint, fixed = 6): string {
  return Amount.fromRaw(raw, usdcDecimals).toFixed(fixed)
}

function formatAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function periodLabel(secs: number, lang: Lang): string {
  if (secs === 120) return t('period2min', lang)
  if (secs === 604800) return t('period1week', lang)
  if (secs === 1296000) return t('period15days', lang)
  if (secs === 2592000) return t('period30days', lang)
  if (secs >= 86400) return `${Math.round(secs / 86400)}d`
  if (secs >= 3600) return `${Math.round(secs / 3600)}h`
  if (secs >= 60) return `${Math.round(secs / 60)}m`
  return `${secs}s`
}

/** Countdown to the next unlock moment given a stream start time and period length. */
function useCountdown(startTime: bigint, periodSeconds: number, periodsClaimedCount: number): string {
  const [label, setLabel] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000)
      const start = Number(startTime)
      const elapsed = now - start
      const nextPeriod = periodsClaimedCount + 1
      const unlockAt = start + nextPeriod * periodSeconds
      const remaining = unlockAt - now

      if (remaining <= 0) {
        setLabel('now')
        return
      }
      if (elapsed < 0) { setLabel(''); return }

      const h = Math.floor(remaining / 3600)
      const m = Math.floor((remaining % 3600) / 60)
      const s = remaining % 60
      if (h > 0) setLabel(`${h}h ${m}m`)
      else if (m > 0) setLabel(`${m}m ${s}s`)
      else setLabel(`${s}s`)
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTime, periodSeconds, periodsClaimedCount])

  return label
}

interface Props {
  streamId: bigint
  stream: StreamData
  role: 'client' | 'payee'
  onRefresh: () => void
  lang: Lang
}

export function StreamCard({ streamId, stream, role, onRefresh, lang }: Props) {
  const { chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const [expanded, setExpanded] = useState(false)
  const isWrongChain = chainId !== ARC_TESTNET_CHAIN_ID

  const { data: claimableData, refetch: refetchClaimable } = useReadContract({
    address: QUINCENA_ADDRESS,
    abi: QUINCENA_ABI,
    functionName: 'claimable',
    args: [streamId],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { refetchInterval: 15_000 },
  })

  const { writeContract: writeClaim, data: claimHash, isPending: claimPending } = useWriteContract()
  const { writeContract: writeCancel, data: cancelHash, isPending: cancelPending } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash })
  const { isLoading: cancelConfirming, isSuccess: cancelSuccess } = useWaitForTransactionReceipt({ hash: cancelHash })

  useEffect(() => {
    if (claimSuccess) {
      toast.success(t('claimProcessed', lang))
      void refetchClaimable()
      onRefresh()
    }
  }, [claimSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cancelSuccess) {
      toast.success(t('streamCancelled', lang))
      onRefresh()
    }
  }, [cancelSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaim = () => {
    if (isWrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    writeClaim({
      address: QUINCENA_ADDRESS,
      abi: QUINCENA_ABI,
      functionName: 'claim(uint256)',
      args: [streamId],
    }, {
      onError: (e) => toast.error(e.message.includes('user rejected') ? t('txCancelled', lang) : t('claimFailed', lang)),
    })
  }

  const handleCancel = () => {
    if (isWrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    writeCancel({
      address: QUINCENA_ADDRESS,
      abi: QUINCENA_ABI,
      functionName: 'cancel',
      args: [streamId],
    }, {
      onError: (e) => toast.error(e.message.includes('user rejected') ? t('txCancelled', lang) : t('cancelFailed', lang)),
    })
  }

  const claimableResult = claimableData as [bigint, bigint] | undefined
  const claimableAmount = claimableResult?.[0] ?? 0n
  const claimablePeriods = Number(claimableResult?.[1] ?? 0n)

  const totalPaid = BigInt(stream.periodsClaimedCount) * stream.amountPerPeriod
  const totalValue = BigInt(stream.periods) * stream.amountPerPeriod
  const progress = stream.periods > 0 ? (stream.periodsClaimedCount / stream.periods) * 100 : 0
  const isFinished = stream.periodsClaimedCount >= stream.periods || stream.cancelled

  const claimBusy = claimPending || claimConfirming
  const cancelBusy = cancelPending || cancelConfirming
  const anyTxHash = claimHash ?? cancelHash
  const txUrl = anyTxHash ? buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, anyTxHash) : null

  // Countdown to next unlock (only for payee view when stream is live)
  const countdown = useCountdown(stream.startTime, stream.periodSeconds, stream.periodsClaimedCount)

  return (
    <div className="rounded-3xl p-5 transition-all" style={glass.card}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="display text-base font-bold" style={{ color: 'var(--ink)' }}>
              #{streamId.toString()}
            </span>
            {stream.cancelled && (
              <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}>
                {t('cancelled', lang)}
              </span>
            )}
            {isFinished && !stream.cancelled && (
              <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}>
                Complete
              </span>
            )}
          </div>
          {stream.memo ? (
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{stream.memo}</p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              {periodLabel(stream.periodSeconds, lang)} · {stream.periods} {t('periodsNotice', lang)}
            </p>
          )}
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 rounded-full p-1.5 transition-colors"
          style={{ background: 'rgba(18,45,69,0.05)' }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded
            ? <ChevronUp className="size-4" style={{ color: 'var(--subtle)' }} />
            : <ChevronDown className="size-4" style={{ color: 'var(--subtle)' }} />}
        </button>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-2xl px-3 py-2.5" style={glass.inner}>
          <p className="text-xs mb-0.5" style={{ color: 'var(--subtle)' }}>{t('perPeriod', lang)}</p>
          <p className="display text-sm font-bold tabular-nums leading-none" style={{ color: 'var(--ink)' }}>
            {fmtUsdc(stream.amountPerPeriod)}
          </p>
        </div>
        <div className="rounded-2xl px-3 py-2.5" style={glass.inner}>
          <p className="text-xs mb-0.5" style={{ color: 'var(--subtle)' }}>{t('periods', lang)}</p>
          <p className="display text-sm font-bold tabular-nums leading-none" style={{ color: 'var(--ink)' }}>
            {stream.periodsClaimedCount}/{stream.periods}
          </p>
        </div>
        <div className="rounded-2xl px-3 py-2.5" style={glass.inner}>
          <p className="text-xs mb-0.5" style={{ color: 'var(--subtle)' }}>{t('claimable', lang)}</p>
          <p
            className="display text-sm font-bold tabular-nums leading-none"
            style={{ color: claimableAmount > 0n ? 'var(--success)' : 'var(--subtle)' }}
          >
            {fmtUsdc(claimableAmount)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(18,45,69,0.08)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(100, progress)}%`,
            background: stream.cancelled
              ? 'var(--danger)'
              : isFinished
              ? 'var(--success)'
              : 'linear-gradient(90deg, var(--accent-hover), var(--success))',
          }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
        <span>{fmtUsdc(totalPaid)} {t('paid', lang)}</span>
        <span>{fmtUsdc(totalValue)} {t('total', lang)}</span>
      </div>

      {/* Payee view: next unlock countdown */}
      {role === 'payee' && !isFinished && countdown && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: 'rgba(133,177,237,0.12)', border: '1px solid rgba(133,177,237,0.24)' }}
        >
          <Timer className="size-3.5 flex-shrink-0" style={{ color: 'var(--accent-hover)' }} />
          <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
            {t('nextUnlock', lang)}: <span className="font-semibold tabular-nums">{countdown === 'now' ? t('claimable', lang) : `${t('unlockIn', lang)} ${countdown}`}</span>
          </span>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 space-y-3">
          {/* Payees */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Users className="size-3" style={{ color: 'var(--muted)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                {t('payeeList', lang)}
              </span>
            </div>
            <div className="space-y-1.5">
              {stream.payees.map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2" style={glass.inner}>
                  <span className="mono text-xs truncate max-w-[60%]" style={{ color: 'var(--ink)' }} title={p}>{formatAddr(p)}</span>
                  <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--muted)' }}>
                    {(stream.bps[i] / 100).toFixed(2)}%
                    <span className="ml-1.5 font-normal" style={{ color: 'var(--subtle)' }}>
                      ({fmtUsdc(stream.amountPerPeriod * BigInt(stream.bps[i]) / 10000n)}/period)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div className="rounded-xl px-3 py-3 space-y-2" style={glass.inner}>
            <div className="mb-1 flex items-center gap-1.5">
              <Clock className="size-3" style={{ color: 'var(--muted)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                {t('schedule', lang)}
              </span>
            </div>
            {[
              [t('periodLengthLabel', lang), periodLabel(stream.periodSeconds, lang)],
              [t('cancelNoticeLabel', lang), `${stream.cancelNoticePeriods} ${t('periodsNotice', lang)}`],
              [t('clientLabel', lang), <span key="client" className="mono">{formatAddr(stream.client)}</span>],
            ].map(([label, value], i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--subtle)' }}>{label}</span>
                <span style={{ color: 'var(--ink)' }} className="font-medium">{value}</span>
              </div>
            ))}
          </div>

          {/* Cancel notice warning */}
          {role === 'client' && !stream.cancelled && stream.cancelNoticePeriods > 0 && (
            <div
              className="flex gap-2 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(255,205,131,0.16)', border: '1px solid rgba(255,205,131,0.36)' }}
            >
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" style={{ color: '#a07000' }} />
              <p className="text-xs" style={{ color: '#7a5400' }}>
                {t('noticePay', lang, { n: stream.cancelNoticePeriods })}
              </p>
            </div>
          )}

          {/* Actions */}
          {!stream.cancelled && (
            <div className="flex gap-2 pt-1">
              {/* Claim (anyone can trigger) */}
              <button
                onClick={handleClaim}
                disabled={claimBusy || cancelBusy || claimablePeriods === 0}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {claimBusy && <Loader2 className="size-3.5 animate-spin" />}
                {claimBusy
                  ? (claimConfirming ? t('confirming', lang) : t('confirmWallet', lang))
                  : claimablePeriods > 0
                  ? `${t('triggerClaim', lang)} (${claimablePeriods})`
                  : t('nothingUnlocked', lang)}
              </button>

              {role === 'client' && (
                <button
                  onClick={handleCancel}
                  disabled={cancelBusy || claimBusy}
                  className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)', border: '1px solid rgba(186,43,76,0.18)' }}
                >
                  {cancelBusy
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : t('cancelStream', lang)}
                </button>
              )}
            </div>
          )}

          {/* Explorer link */}
          {txUrl && (
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium"
              style={{ color: 'var(--accent-hover)' }}
            >
              <ExternalLink className="size-3" />
              {t('viewExplorer', lang)}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
