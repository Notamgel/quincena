/**
 * Minimal EN/ES label dictionary for Quincena.
 */

export type Lang = 'en' | 'es'

const labels = {
  // App shell
  appTagline: { en: 'USDC Payroll Streams', es: 'Nómina en USDC' },
  connectWallet: { en: 'Connect Wallet', es: 'Conectar billetera' },
  connectPrompt: {
    en: 'Create recurring USDC payment streams for contractors, teams, and recurring obligations. Powered by Arc.',
    es: 'Crea flujos de pago recurrentes en USDC para contratistas, equipos y obligaciones periódicas. Impulsado por Arc.',
  },
  paying: { en: 'Paying', es: 'Pagando' },
  receiving: { en: 'Receiving', es: 'Recibiendo' },
  refresh: { en: 'Refresh', es: 'Actualizar' },
  noActiveStreams: { en: 'No active streams. Create one above to start paying.', es: 'Sin flujos activos. Crea uno arriba para comenzar a pagar.' },
  noPayeeStreams: { en: 'No streams found where you are a payee.', es: 'No hay flujos donde seas beneficiario.' },
  stream: { en: 'stream', es: 'flujo' },
  streams: { en: 'streams', es: 'flujos' },

  // Create sheet
  newStream: { en: 'New Payroll Stream', es: 'Nuevo flujo de nómina' },
  payees: { en: 'Payees', es: 'Beneficiarios' },
  addPayee: { en: 'Add payee', es: 'Agregar beneficiario' },
  sharePercent: { en: 'Share %', es: 'Parte %' },
  addressPlaceholder: { en: '0x address', es: 'Dirección 0x' },
  amountPerPeriod: { en: 'Amount per period (USDC)', es: 'Monto por período (USDC)' },
  periodLength: { en: 'Period length', es: 'Duración del período' },
  numberOfPeriods: { en: 'Number of periods', es: 'Número de períodos' },
  cancelNotice: { en: 'Cancel notice (periods)', es: 'Aviso de cancelación (períodos)' },
  cancelNoticeHint: {
    en: 'On cancel, payees keep the next {n} period(s) as notice pay.',
    es: 'Al cancelar, los beneficiarios conservan {n} período(s) como pago de preaviso.',
  },
  memo: { en: 'Memo (optional)', es: 'Nota (opcional)' },
  memoPlaceholder: { en: 'e.g. Q4 contractor payment', es: 'Ej. Pago contratista Q4' },
  totalLabel: { en: 'total', es: 'total' },
  approveCreate: { en: 'Approve & Create', es: 'Aprobar y crear' },
  approving: { en: 'Approving USDC…', es: 'Aprobando USDC…' },
  creating: { en: 'Creating stream…', es: 'Creando flujo…' },
  done: { en: 'Done!', es: '¡Listo!' },
  switchNetwork: { en: 'Switch to Arc Testnet', es: 'Cambiar a Arc Testnet' },
  viewExplorer: { en: 'View on ArcScan', es: 'Ver en ArcScan' },
  streamCreated: { en: 'Payroll stream created!', es: '¡Flujo de nómina creado!' },

  // Period presets
  period2min: { en: '2 minutes (demo)', es: '2 minutos (demo)' },
  period1week: { en: '1 week', es: '1 semana' },
  period15days: { en: '15 days (quincena)', es: '15 días (quincena)' },
  period30days: { en: '30 days', es: '30 días' },

  // Stream card
  perPeriod: { en: 'Per period', es: 'Por período' },
  periods: { en: 'Periods', es: 'Períodos' },
  claimable: { en: 'Claimable', es: 'Disponible' },
  paid: { en: 'paid', es: 'pagado' },
  total: { en: 'total', es: 'total' },
  cancelled: { en: 'Cancelled', es: 'Cancelado' },
  cancelledNoticePay: { en: 'Cancelled · notice pay claimable', es: 'Cancelado · preaviso disponible' },
  payeeList: { en: 'Payees', es: 'Beneficiarios' },
  schedule: { en: 'Schedule', es: 'Programación' },
  periodLengthLabel: { en: 'Period length', es: 'Duración del período' },
  cancelNoticeLabel: { en: 'Cancel notice', es: 'Aviso de cancelación' },
  clientLabel: { en: 'Client', es: 'Cliente' },
  noticePay: {
    en: 'Cancellation locks in {n} period(s) of notice pay before refunding the rest.',
    es: 'La cancelación protege {n} período(s) de pago de preaviso antes de devolver el resto.',
  },
  triggerClaim: { en: 'Trigger claim', es: 'Cobrar' },
  nothingUnlocked: { en: 'Nothing unlocked', es: 'Nada disponible' },
  confirming: { en: 'Confirming…', es: 'Confirmando…' },
  confirmWallet: { en: 'Confirm in wallet…', es: 'Confirmar en billetera…' },
  cancelStream: { en: 'Cancel stream', es: 'Cancelar flujo' },
  claimProcessed: { en: 'Claim processed — payees can now withdraw.', es: 'Cobro procesado — los beneficiarios ya pueden retirar.' },
  streamCancelled: { en: 'Stream cancelled. Refund sent.', es: 'Flujo cancelado. Reembolso enviado.' },
  claimFailed: { en: 'Claim failed.', es: 'Fallo al cobrar.' },
  cancelFailed: { en: 'Cancel failed.', es: 'Fallo al cancelar.' },
  txCancelled: { en: 'Cancelled.', es: 'Cancelado.' },
  nextUnlock: { en: 'Next unlock', es: 'Próximo desbloqueo' },
  unlockIn: { en: 'in', es: 'en' },

  // Withdraw card
  payeeBalance: { en: 'Payee Balance', es: 'Balance como beneficiario' },
  earnedWaiting: { en: 'Earned USDC ready to withdraw', es: 'USDC ganado listo para retirar' },
  claimableNow: { en: 'Ready to withdraw', es: 'Listo para retirar' },
  walletBalance: { en: 'Wallet balance', es: 'Balance en billetera' },
  withdrawUsdc: { en: 'Withdraw USDC', es: 'Retirar USDC' },
  nothingToWithdraw: { en: 'Nothing to withdraw', es: 'Nada para retirar' },
  withdrawn: { en: 'Withdrawn!', es: '¡Retirado!' },
  withdrawFailed: { en: 'Withdraw failed.', es: 'Fallo al retirar.' },
  periodsNotice: { en: 'periods', es: 'períodos' },
} as const

type LabelKey = keyof typeof labels

export function t(key: LabelKey, lang: Lang, vars?: Record<string, string | number>): string {
  let str: string = labels[key][lang]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v))
    }
  }
  return str
}
