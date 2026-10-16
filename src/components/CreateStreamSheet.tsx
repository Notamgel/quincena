import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Loader2, ExternalLink, ChevronDown } from 'lucide-react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { QUINCENA_ADDRESS, QUINCENA_ABI, ARC_TESTNET_CHAIN_ID } from '../quincena'
import { getUsdc } from '@/onchain-facts'
import { parseAmount, Amount, usdcDecimalsFor } from '@/onchain-money'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { Lang } from '../i18n'
import { t } from '../i18n'

const spectral = 'linear-gradient(90deg, #5fbeff, #af8ff4, #f05c6b, #ffcd83, #7ef1b3)'
const spring = { type: 'spring' as const, stiffness: 380, damping: 34, mass: 0.9 }

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
    borderRadius: '0.75rem',
  } as React.CSSProperties,
}

interface Payee {
  address: string
  pct: string // human percent, e.g. "50.5"
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  lang: Lang
}

const USDC_ADDRESS = getUsdc(ARC_TESTNET_CHAIN_ID)?.address as `0x${string}`
const usdcDecimals = usdcDecimalsFor(ARC_TESTNET_CHAIN_ID)

// Period presets: [labelKey, seconds]
const PERIOD_PRESETS: Array<{ key: 'period2min' | 'period1week' | 'period15days' | 'period30days'; secs: number }> = [
  { key: 'period2min', secs: 120 },
  { key: 'period1week', secs: 604800 },
  { key: 'period15days', secs: 1296000 },
  { key: 'period30days', secs: 2592000 },
]

function pctToBps(pct: string): number {
  const v = parseFloat(pct)
  if (isNaN(v)) return 0
  return Math.round(v * 100)
}

function totalBpsFromPayees(payees: Payee[]): number {
  return payees.reduce((s, p) => s + pctToBps(p.pct), 0)
}

function fmtUsdc6(raw: bigint): string {
  return Amount.fromRaw(raw, usdcDecimals).toFixed(6)
}

export function CreateStreamSheet({ open, onClose, onCreated, lang }: Props) {
  const { chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [payees, setPayees] = useState<Payee[]>([{ address: '', pct: '100' }])
  const [amountPerPeriod, setAmountPerPeriod] = useState('')
  const [periodSecs, setPeriodSecs] = useState(604800)
  const [numPeriods, setNumPeriods] = useState('4')
  const [noticePeriods, setNoticePeriods] = useState('2')
  const [memo, setMemo] = useState('')
  const [step, setStep] = useState<'idle' | 'approving' | 'creating' | 'done'>('idle')

  const { writeContract: writeApprove, data: approveHash, isPending: approvePending } = useWriteContract()
  const { writeContract: writeCreate, data: createHash, isPending: createPending } = useWriteContract()
  const { isLoading: approveConfirming } = useWaitForTransactionReceipt({ hash: approveHash })
  const { isLoading: createConfirming, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createHash })

  const isWrongChain = chainId !== ARC_TESTNET_CHAIN_ID
  const totalBps = totalBpsFromPayees(payees)
  const bpsOk = totalBps === 10000

  const parsedAmount = amountPerPeriod && /^\d*\.?\d{0,6}$/.test(amountPerPeriod) && parseFloat(amountPerPeriod) > 0
    ? (() => { try { return parseAmount(ARC_TESTNET_CHAIN_ID, amountPerPeriod) } catch { return null } })()
    : null

  const periodsNum = Math.max(0, parseInt(numPeriods) || 0)
  const totalRaw = parsedAmount ? parsedAmount.raw * BigInt(periodsNum) : 0n

  const isValid =
    payees.length >= 1 &&
    payees.length <= 5 &&
    payees.every(p => /^0x[0-9a-fA-F]{40}$/.test(p.address)) &&
    bpsOk &&
    parsedAmount !== null &&
    periodsNum >= 1 && periodsNum <= 1000 &&
    periodSecs > 0

  const addPayee = () => {
    if (payees.length >= 5) return
    setPayees(prev => [...prev, { address: '', pct: '0' }])
  }

  const removePayee = (i: number) => setPayees(prev => prev.filter((_, idx) => idx !== i))

  const updatePayee = (i: number, field: keyof Payee, value: string) => {
    setPayees(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  // Approve → then immediately submit createStream on confirmation
  const handleApprove = () => {
    if (isWrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    if (!isValid || !parsedAmount) return
    const capturedPayees = payees
    const capturedParsed = parsedAmount
    const capturedPeriodSecs = periodSecs
    const capturedPeriodsNum = periodsNum
    const capturedNoticePeriods = parseInt(noticePeriods) || 0
    const capturedMemo = memo

    setStep('approving')
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [QUINCENA_ADDRESS, totalRaw],
    }, {
      onError: (e) => {
        toast.error(e.message.includes('user rejected') ? t('txCancelled', lang) : 'Approval failed.')
        setStep('idle')
      },
      onSuccess: () => {
        setStep('creating')
        const payeeAddrs = capturedPayees.map(p => p.address as `0x${string}`)
        const bpsArr = capturedPayees.map(p => pctToBps(p.pct))
        writeCreate({
          address: QUINCENA_ADDRESS,
          abi: QUINCENA_ABI,
          functionName: 'createStream',
          args: [payeeAddrs, bpsArr, capturedParsed.raw, capturedPeriodSecs, capturedPeriodsNum, capturedNoticePeriods, capturedMemo],
        }, {
          onError: (e) => {
            toast.error(e.message.includes('user rejected') ? t('txCancelled', lang) : 'Stream creation failed.')
            setStep('idle')
          },
          onSuccess: () => {
            setStep('done')
            toast.success(t('streamCreated', lang))
            onCreated()
          },
        })
      },
    })
  }

  const busy = approvePending || approveConfirming || createPending || createConfirming
  // createSuccess used to show explorer link even after onSuccess fires
  void createSuccess
  const explorerUrl = createHash ? buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, createHash) : null

  const btnLabel = () => {
    if (isWrongChain) return t('switchNetwork', lang)
    if (step === 'approving' && (approvePending || approveConfirming)) return t('approving', lang)
    if (step === 'creating' && (createPending || createConfirming)) return t('creating', lang)
    if (step === 'done') return t('done', lang)
    const total = parsedAmount && periodsNum > 0 ? fmtUsdc6(totalRaw) : '0.000000'
    return `${t('approveCreate', lang)} — ${total} USDC`
  }

  // Progress indicator for 2-step flow
  const stepNum = step === 'idle' ? 0 : step === 'approving' ? 1 : step === 'creating' ? 2 : 3

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl flex flex-col"
            style={{
              maxHeight: '94dvh',
              background: 'rgba(250,250,253,0.96)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            }}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={spring}
            onClick={e => e.stopPropagation()}
          >
            {/* Spectral strip */}
            <div className="h-1 flex-shrink-0" style={{ background: spectral }} />

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="h-1 w-10 rounded-full" style={{ background: 'rgba(18,45,69,0.12)' }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-2 pb-4 flex-shrink-0">
              <div>
                <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>{t('newStream', lang)}</h2>
                {step !== 'idle' && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {[1, 2, 3].map(n => (
                      <div
                        key={n}
                        className="h-1 rounded-full transition-all duration-300"
                        style={{
                          width: n <= stepNum ? 24 : 8,
                          background: n <= stepNum ? 'var(--success)' : 'rgba(18,45,69,0.12)',
                        }}
                      />
                    ))}
                    <span className="text-xs ml-1" style={{ color: 'var(--muted)' }}>
                      {step === 'approving' ? 'Step 1/2' : step === 'creating' ? 'Step 2/2' : ''}
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 transition-colors"
                style={{ background: 'rgba(18,45,69,0.06)' }}
              >
                <X className="size-4" style={{ color: 'var(--muted)' }} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 pb-8">

              {/* --- Payees --- */}
              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    {t('payees', lang)}
                  </label>
                  <span
                    className="text-xs font-semibold tabular-nums"
                    style={{ color: bpsOk ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {(totalBps / 100).toFixed(2)}% / 100%
                  </span>
                </div>

                <div className="space-y-2">
                  {payees.map((p, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={p.address}
                        onChange={e => updatePayee(i, 'address', e.target.value.trim())}
                        placeholder={t('addressPlaceholder', lang)}
                        className="mono flex-1 min-w-0 px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                        style={{ ...glass.inner, color: 'var(--ink)' }}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <div className="relative flex-shrink-0">
                        <input
                          inputMode="decimal"
                          value={p.pct}
                          onChange={e => {
                            const v = e.target.value.replace(/[^0-9.]/g, '')
                            if (v === '' || /^\d*\.?\d{0,4}$/.test(v)) updatePayee(i, 'pct', v)
                          }}
                          placeholder="0"
                          className="w-20 px-3 py-2.5 text-sm tabular-nums text-right outline-none focus:ring-2 focus:ring-blue-200 pr-6"
                          style={{ ...glass.inner, color: 'var(--ink)' }}
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--subtle)' }}>%</span>
                      </div>
                      {payees.length > 1 && (
                        <button
                          onClick={() => removePayee(i)}
                          className="rounded-xl p-2 transition-colors flex-shrink-0"
                          style={{ background: 'rgba(186,43,76,0.06)' }}
                        >
                          <Trash2 className="size-3.5" style={{ color: 'var(--danger)' }} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {payees.length < 5 && (
                  <button
                    onClick={addPayee}
                    className="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
                    style={{ color: 'var(--accent-hover)', background: 'rgba(16,97,166,0.06)' }}
                  >
                    <Plus className="size-3" />
                    {t('addPayee', lang)}
                  </button>
                )}
              </div>

              {/* --- Amount per period --- */}
              <div className="mb-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  {t('amountPerPeriod', lang)}
                </label>
                <div className="flex items-center gap-2 px-4 py-3" style={{ ...glass.inner, borderRadius: '1rem' }}>
                  <input
                    inputMode="decimal"
                    value={amountPerPeriod}
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) setAmountPerPeriod(v)
                    }}
                    placeholder="0.000000"
                    className="display flex-1 bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:text-slate-300"
                    style={{ color: 'var(--ink)' }}
                  />
                  <span className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--subtle)' }}>USDC</span>
                </div>
              </div>

              {/* --- Period presets --- */}
              <div className="mb-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  {t('periodLength', lang)}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PERIOD_PRESETS.map(p => (
                    <button
                      key={p.secs}
                      onClick={() => setPeriodSecs(p.secs)}
                      className="rounded-xl px-3 py-2.5 text-xs font-semibold text-left transition-all"
                      style={
                        periodSecs === p.secs
                          ? { background: 'var(--accent)', color: 'white', boxShadow: '0 2px 8px rgba(18,45,69,0.18)' }
                          : { ...glass.inner, color: 'var(--ink-2)' }
                      }
                    >
                      {t(p.key, lang)}
                    </button>
                  ))}
                </div>
              </div>

              {/* --- Number of periods + cancel notice --- */}
              <div className="mb-5 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    {t('numberOfPeriods', lang)}
                  </label>
                  <input
                    type="number"
                    value={numPeriods}
                    min={1} max={1000}
                    onChange={e => setNumPeriods(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-200"
                    style={{ ...glass.inner, color: 'var(--ink)' }}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    {t('cancelNotice', lang)}
                  </label>
                  <input
                    type="number"
                    value={noticePeriods}
                    min={0}
                    onChange={e => setNoticePeriods(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-200"
                    style={{ ...glass.inner, color: 'var(--ink)' }}
                  />
                </div>
              </div>
              <p className="mb-5 -mt-3 text-xs px-0.5" style={{ color: 'var(--subtle)' }}>
                {t('cancelNoticeHint', lang, { n: noticePeriods || '0' })}
              </p>

              {/* --- Memo --- */}
              <div className="mb-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  {t('memo', lang)}
                </label>
                <input
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  placeholder={t('memoPlaceholder', lang)}
                  className="w-full px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  style={{ ...glass.inner, color: 'var(--ink)' }}
                />
              </div>

              {/* --- Summary --- */}
              {isValid && (
                <div className="mb-5 px-4 py-3 rounded-2xl" style={{ background: 'rgba(26,128,71,0.06)', border: '1px solid rgba(26,128,71,0.14)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                      {periodsNum}× {PERIOD_PRESETS.find(p => p.secs === periodSecs) ? t(PERIOD_PRESETS.find(p => p.secs === periodSecs)!.key, lang) : `${periodSecs}s`}
                    </span>
                    <span className="display text-sm font-bold tabular-nums" style={{ color: 'var(--success)' }}>
                      {fmtUsdc6(totalRaw)} USDC {t('totalLabel', lang)}
                    </span>
                  </div>
                </div>
              )}

              {/* --- CTA --- */}
              <button
                disabled={!isValid || busy || step === 'done'}
                onClick={handleApprove}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {btnLabel()}
              </button>

              {explorerUrl && (step === 'done' || step === 'creating') && (
                <a
                  href={explorerUrl}
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
          </motion.section>

          {/* Invisible expand hint */}
          <ChevronDown className="sr-only" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
