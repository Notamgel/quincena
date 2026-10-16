import { useState, useCallback } from 'react'
import { ConnectKitButton } from 'connectkit'
import { Plus, Wallet, ArrowDownToLine, RefreshCw } from 'lucide-react'
import { useAccount, useReadContracts } from 'wagmi'
import { TokenUSDC } from '@web3icons/react'
import { CreateStreamSheet } from './components/CreateStreamSheet'
import { StreamCard } from './components/StreamCard'
import { WithdrawCard } from './components/WithdrawCard'
import { QUINCENA_ABI, ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID, getQuincenaAddress, type StreamData } from './quincena'
import type { Lang } from './i18n'
import { t } from './i18n'

const spectral = 'linear-gradient(90deg, #5fbeff, #af8ff4, #f05c6b, #ffcd83, #7ef1b3)'

type Tab = 'client' | 'payee'

function useStreamIds(address: `0x${string}` | undefined, fn: 'streamsOfClient' | 'streamsOfPayee', chainId: number) {
  const contractAddress = getQuincenaAddress(chainId)
  const { data } = useReadContracts({
    contracts: address && contractAddress
      ? [{ address: contractAddress, abi: QUINCENA_ABI, functionName: fn, args: [address], chainId }]
      : [],
  })
  const ids = data?.[0]?.result as bigint[] | undefined
  return ids ?? []
}

function useStreams(ids: bigint[], refreshKey: number, chainId: number) {
  const contractAddress = getQuincenaAddress(chainId)
  const { data } = useReadContracts({
    contracts: ids.map(id => ({
      address: contractAddress!,
      abi: QUINCENA_ABI,
      functionName: 'getStream',
      args: [id],
      chainId,
    })),
    query: { enabled: ids.length > 0 && !!contractAddress, gcTime: 0 },
  })
  void refreshKey
  return (data ?? []).map((r, i) => ({
    id: ids[i],
    stream: r.result as StreamData | undefined,
  }))
}

export default function App() {
  const { address, isConnected, chainId } = useAccount()
  const [tab, setTab] = useState<Tab>('client')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [lang, setLang] = useState<Lang>('en')

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const activeChainId = chainId ?? ARC_TESTNET_CHAIN_ID
  const isMainnet = activeChainId === ARC_MAINNET_CHAIN_ID
  const clientIds = useStreamIds(address, 'streamsOfClient', activeChainId)
  const payeeIds = useStreamIds(address, 'streamsOfPayee', activeChainId)
  const clientStreams = useStreams(clientIds, refreshKey, activeChainId)
  const payeeStreams = useStreams(payeeIds, refreshKey, activeChainId)

  const visibleStreams = tab === 'client' ? clientStreams : payeeStreams
  const streamCount = visibleStreams.filter(s => s.stream).length

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: 'linear-gradient(180deg, #f9f9fc 0%, #fffcf7 52%, #fbf7f2 100%)' }}>
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: 'absolute', top: '5%', left: '2%', width: 340, height: 340, borderRadius: '50%', background: 'radial-gradient(circle, rgba(133,177,237,0.18) 0%, transparent 70%)', filter: 'blur(64px)' }} />
        <div style={{ position: 'absolute', bottom: '8%', right: '3%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,205,131,0.16) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-4 pb-12 pt-6">
        {/* Header */}
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="flex size-9 items-center justify-center rounded-xl shadow-sm"
              style={{ background: 'var(--accent)' }}
            >
              <TokenUSDC size={18} variant="branded" />
            </div>
            <div>
              <div className="flex items-center gap-2 leading-none">
                <span className="display text-xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
                  Quincena
                </span>
                {isMainnet && isConnected && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
                    style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)', border: '1px solid rgba(26,128,71,0.22)' }}
                  >
                    Mainnet
                  </span>
                )}
              </div>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {isMainnet && isConnected ? 'Real USDC · Arc Mainnet' : t('appTagline', lang)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <button
              onClick={() => setLang(l => l === 'en' ? 'es' : 'en')}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
              style={{
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(255,255,255,0.68)',
                color: 'var(--ink-2)',
                boxShadow: '0 2px 8px rgba(18,45,69,0.06)',
              }}
              aria-label={lang === 'en' ? 'Switch to Spanish' : 'Switch to English'}
            >
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
            <ConnectKitButton />
          </div>
        </header>

        {!isConnected ? (
          /* ── Not connected ─────────────────────────────── */
          <div
            className="overflow-hidden rounded-3xl"
            style={{
              background: 'rgba(255,255,255,0.64)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid rgba(255,255,255,0.68)',
              boxShadow: '0 8px 32px rgba(18,45,69,0.08)',
            }}
          >
            <div className="h-1" style={{ background: spectral }} />
            <div className="p-8 text-center">
              <div
                className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl"
                style={{ background: 'rgba(18,45,69,0.06)' }}
              >
                <Wallet className="size-7" style={{ color: 'var(--accent)' }} />
              </div>
              <h2 className="display mb-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>
                {t('appTagline', lang)}
              </h2>
              <p className="mb-6 text-sm text-pretty" style={{ color: 'var(--muted)', maxWidth: '28ch', margin: '0 auto 1.5rem' }}>
                {t('connectPrompt', lang)}
              </p>
              <ConnectKitButton label={t('connectWallet', lang)} />
            </div>
          </div>
        ) : (
          <>
            {/* ── Mainnet real-funds notice ────────────────── */}
            {isMainnet && (
              <div
                className="mb-4 flex items-start gap-2.5 rounded-2xl px-4 py-3"
                style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.18)' }}
              >
                <span className="mt-0.5 text-base leading-none">🟢</span>
                <p className="text-xs leading-relaxed" style={{ color: '#1a5c33' }}>
                  <span className="font-bold">Arc Mainnet — real USDC.</span> Streams on this network use actual funds. All transactions are irreversible.
                </p>
              </div>
            )}

            {/* ── Withdraw card ───────────────────────────── */}
            <div className="mb-3">
              <WithdrawCard lang={lang} />
            </div>

            {/* ── Tabs ────────────────────────────────────── */}
            <div
              className="mb-5 flex rounded-2xl p-1"
              style={{ background: 'rgba(255,255,255,0.52)', border: '1px solid rgba(255,255,255,0.60)' }}
            >
              {(['client', 'payee'] as Tab[]).map(tabKey => (
                <button
                  key={tabKey}
                  onClick={() => setTab(tabKey)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all"
                  style={{
                    background: tab === tabKey ? 'rgba(255,255,255,0.92)' : 'transparent',
                    color: tab === tabKey ? 'var(--ink)' : 'var(--muted)',
                    boxShadow: tab === tabKey ? '0 2px 8px rgba(18,45,69,0.07)' : 'none',
                  }}
                >
                  {tabKey === 'client'
                    ? <><ArrowDownToLine className="size-3.5" />{t('paying', lang)}</>
                    : <><Wallet className="size-3.5" />{t('receiving', lang)}</>}
                </button>
              ))}
            </div>

            {/* ── New Stream button (client tab only) ─────── */}
            {tab === 'client' && (
              <button
                onClick={() => setSheetOpen(true)}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: 'var(--accent)', boxShadow: '0 4px 16px rgba(18,45,69,0.18)' }}
              >
                <Plus className="size-4" />
                {t('newStream', lang)}
              </button>
            )}

            {/* ── Stream list ──────────────────────────────── */}
            {streamCount === 0 ? (
              <div
                className="rounded-3xl p-8 text-center"
                style={{
                  background: 'rgba(255,255,255,0.64)',
                  backdropFilter: 'blur(24px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                  border: '1px solid rgba(255,255,255,0.68)',
                  boxShadow: '0 8px 32px rgba(18,45,69,0.08)',
                }}
              >
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {tab === 'client' ? t('noActiveStreams', lang) : t('noPayeeStreams', lang)}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    {streamCount} {streamCount === 1 ? t('stream', lang) : t('streams', lang)}
                  </span>
                  <button
                    onClick={refresh}
                    className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    <RefreshCw className="size-3" />
                    {t('refresh', lang)}
                  </button>
                </div>

                {visibleStreams.map(({ id, stream }) =>
                  stream ? (
                    <StreamCard
                      key={id.toString()}
                      streamId={id}
                      stream={stream}
                      role={tab === 'client' ? 'client' : 'payee'}
                      onRefresh={refresh}
                      lang={lang}
                    />
                  ) : null
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create stream sheet */}
      <CreateStreamSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => {
          setSheetOpen(false)
          refresh()
        }}
        lang={lang}
      />
    </div>
  )
}
