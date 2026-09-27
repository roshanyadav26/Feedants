import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import './App.css'

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
).replace(/\/$/, '')

const PAGE_SIZE = 20

const ENTRY_STATUSES = [
  'submitted',
  'under_review',
  'accepted',
  'rejected',
] as const

const REGISTRATION_STATUSES = [
  'pending_payment',
  'confirmed',
  'cancelled',
] as const

type EntryStatus = (typeof ENTRY_STATUSES)[number]
type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

type Pagination = {
  page: number
  limit: number
  totalItems: number
  totalPages: number
}

type Registration = {
  _id: string
  participantName: string
  email: string
  paymentStatus: 'pending' | 'paid' | 'failed'
  registrationStatus: RegistrationStatus
  competition: { slug: string; title: string } | null
  createdAt: string
}

type Entry = {
  _id: string
  registration: {
    _id: string
    participantName: string
    email: string
    registrationStatus: RegistrationStatus
    paymentStatus: string
  } | null
  participantName: string
  email: string
  competitionSlug: string
  video: {
    fileName: string
    originalFileName: string
    filePath: string
    mimeType: string
    fileSize: number
  }
  submissionStatus: EntryStatus
  paymentStatus: 'pending' | 'paid' | 'failed'
  createdAt: string
  updatedAt: string
}

type View = 'overview' | 'registrations' | 'entries'

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      typeof payload.message === 'string'
        ? payload.message
        : 'The request could not be completed.',
      response.status,
    )
  }

  return payload as T
}

const pretty = (value: string) => value.replaceAll('_', ' ')

const date = (value: string) => {
  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(parsed)
}

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  if (name === 'grid') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  }

  if (name === 'users') {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  }

  if (name === 'video') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="13" height="14" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </svg>
    )
  }

  if (name === 'search') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
    )
  }

  if (name === 'chevron') {
    return (
      <svg {...common}>
        <path d="m9 18 6-6-6-6" />
      </svg>
    )
  }

  if (name === 'logout') {
    return (
      <svg {...common}>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
      <path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z" />
    </svg>
  )
}

function App() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem('feedants_admin_token')
    } catch {
      return null
    }
  })

  const [view, setView] = useState<View>('overview')
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [registrationPagination, setRegistrationPagination] =
    useState<Pagination | null>(null)
  const [entryPagination, setEntryPagination] =
    useState<Pagination | null>(null)
  const [registrationPage, setRegistrationPage] = useState(1)
  const [entryPage, setEntryPage] = useState(1)
  const [registrationFilter, setRegistrationFilter] = useState('')
  const [entryFilter, setEntryFilter] = useState('')
  const [registrationLoading, setRegistrationLoading] = useState(false)
  const [entryLoading, setEntryLoading] = useState(false)
  const [registrationError, setRegistrationError] = useState('')
  const [entryError, setEntryError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [updatingEntry, setUpdatingEntry] = useState('')
  const [updatingPayment, setUpdatingPayment] = useState('')
  const [search, setSearch] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)

  const logout = useCallback((expired = false) => {
    try {
      sessionStorage.removeItem('feedants_admin_token')
    } catch {
      /* storage may be disabled */
    }

    setToken(null)
    setSessionExpired(expired)
    setRegistrations([])
    setEntries([])
  }, [])

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      })

      if (response.status === 401) {
        logout(true)
        throw new ApiError(
          'Your session has expired. Please sign in again.',
          401,
        )
      }

      return readResponse<T>(response)
    },
    [logout, token],
  )

  const loadRegistrations = useCallback(
    async (page = 1, status = registrationFilter) => {
      if (!token) return

      setRegistrationLoading(true)
      setRegistrationError('')

      try {
        const query = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        })

        if (status) query.set('registrationStatus', status)

        const data = await request<{
          registrations: Registration[]
          pagination: Pagination
        }>(`/admin/registrations?${query}`)

        setRegistrations(data.registrations)
        setRegistrationPagination(data.pagination)
        setRegistrationPage(page)
      } catch (error) {
        setRegistrationError(
          error instanceof Error
            ? error.message
            : 'Could not load registrations.',
        )
      } finally {
        setRegistrationLoading(false)
      }
    },
    [registrationFilter, request, token],
  )

  const loadEntries = useCallback(
    async (page = 1, status = entryFilter) => {
      if (!token) return

      setEntryLoading(true)
      setEntryError('')

      try {
        const query = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        })

        if (status) query.set('submissionStatus', status)

        const data = await request<{
          entries: Entry[]
          pagination: Pagination
        }>(`/admin/entries?${query}`)

        setEntries(data.entries)
        setEntryPagination(data.pagination)
        setEntryPage(page)
      } catch (error) {
        setEntryError(
          error instanceof Error
            ? error.message
            : 'Could not load video entries.',
        )
      } finally {
        setEntryLoading(false)
      }
    },
    [entryFilter, request, token],
  )

  useEffect(() => {
    if (!token) return

    const loadInitialData = window.setTimeout(() => {
      void loadRegistrations(1)
      void loadEntries(1)
    }, 0)

    return () => window.clearTimeout(loadInitialData)
  }, [token, loadRegistrations, loadEntries])

  function handleLogin(newToken: string) {
    try {
      sessionStorage.setItem('feedants_admin_token', newToken)
    } catch {
      /* token remains available for this tab */
    }

    setToken(newToken)
    setSessionExpired(false)
    setView('overview')
  }

  async function updateEntryStatus(
    entryId: string,
    submissionStatus: EntryStatus,
  ) {
    if (!token) return

    setUpdatingEntry(entryId)
    setActionMessage('')

    try {
      await request<{ entry: Entry }>(
        `/admin/entries/${entryId}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ submissionStatus }),
        },
      )

      setEntries((current) =>
        current.map((entry) =>
          entry._id === entryId
            ? { ...entry, submissionStatus }
            : entry,
        ),
      )

      setActionMessage('Review status updated.')
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : 'Could not update review status.',
      )
    } finally {
      setUpdatingEntry('')
    }
  }

  async function verifyPayment(registrationId: string) {
    if (!token) return

    const confirmed = window.confirm(
      'Have you verified that this participant has actually paid?',
    )

    if (!confirmed) return

    setUpdatingPayment(registrationId)
    setActionMessage('')

    try {
      await request<{ registration: Registration }>(
        `/admin/registrations/${registrationId}/payment`,
        {
          method: 'PATCH',
          body: JSON.stringify({ paymentStatus: 'paid' }),
        },
      )

      setRegistrations((current) =>
        current.map((registration) =>
          registration._id === registrationId
            ? {
                ...registration,
                paymentStatus: 'paid',
                registrationStatus: 'confirmed',
              }
            : registration,
        ),
      )

      setActionMessage(
        'Payment verified and registration confirmed.',
      )
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : 'Could not verify payment.',
      )
    } finally {
      setUpdatingPayment('')
    }
  }

  const filteredRegistrations = useMemo(
    () =>
      registrations.filter((row) => {
        const term = search.trim().toLowerCase()

        return (
          !term ||
          [
            row.participantName,
            row.email,
            row.competition?.title || '',
          ].some((part) => part.toLowerCase().includes(term))
        )
      }),
    [registrations, search],
  )

  const filteredEntries = useMemo(
    () =>
      entries.filter((row) => {
        const term = search.trim().toLowerCase()

        return (
          !term ||
          [
            row.participantName,
            row.email,
            row.competitionSlug,
            row.video.originalFileName,
          ].some((part) => part.toLowerCase().includes(term))
        )
      }),
    [entries, search],
  )

  const title =
    view === 'overview'
      ? 'Overview'
      : view === 'registrations'
        ? 'Registrations'
        : 'Video entries'

  if (!token) {
    return <LoginPage onLogin={handleLogin} expired={sessionExpired} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(event) => {
            event.preventDefault()
            setView('overview')
          }}
        >
          <span className="brand-mark">
            <Icon name="spark" size={21} />
          </span>
          <span>
            feedants<span className="brand-dot">.</span>
            <small>ADMIN CONSOLE</small>
          </span>
        </a>

        <div className="side-label">WORKSPACE</div>

        <nav className="side-nav" aria-label="Main navigation">
          <NavButton
            icon="grid"
            active={view === 'overview'}
            onClick={() => setView('overview')}
          >
            Overview
          </NavButton>

          <NavButton
            icon="users"
            active={view === 'registrations'}
            count={registrationPagination?.totalItems}
            onClick={() => setView('registrations')}
          >
            Registrations
          </NavButton>

          <NavButton
            icon="video"
            active={view === 'entries'}
            count={entryPagination?.totalItems}
            onClick={() => setView('entries')}
          >
            Video entries
          </NavButton>
        </nav>

        <div className="sidebar-bottom">
          <div className="admin-profile">
            <span className="profile-avatar">A</span>
            <span className="profile-copy">
              <strong>Administrator</strong>
              <small>Workspace owner</small>
            </span>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => logout()}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>

          <div className="sidebar-footnote">
            <i /> API connection ready
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">
              <Icon name="spark" size={18} />
            </span>
            feedants<span className="brand-dot">.</span>
          </div>

          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={14} />
            <strong>{title}</strong>
          </div>

          <div className="topbar-actions">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search current page"
                aria-label="Search current page"
              />
            </label>
            <span className="top-avatar">A</span>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FEEDANTS / ADMIN</div>
              <h1>{title}</h1>
              <p>
                Manage competition registrations and review submitted
                videos.
              </p>
            </div>

            <div className="heading-actions">
              <span className="live-tag">
                <i /> Live workspace
              </span>
              <button
                className="refresh-button"
                onClick={() => {
                  void loadRegistrations(registrationPage)
                  void loadEntries(entryPage)
                }}
              >
                <span>↻</span> Refresh data
              </button>
            </div>
          </div>

          {actionMessage && (
            <div
              className={
                actionMessage.includes('updated') ||
                actionMessage.includes('confirmed')
                  ? 'notice success-notice'
                  : 'notice error-notice'
              }
              role="status"
            >
              {actionMessage}
              <button
                aria-label="Dismiss message"
                onClick={() => setActionMessage('')}
              >
                ×
              </button>
            </div>
          )}

          <section className="summary-grid" aria-label="Workspace summary">
            <SummaryCard
              icon="users"
              label="Registrations"
              value={registrationPagination?.totalItems}
              detail="Across all competitions"
              tone="blue"
            />
            <SummaryCard
              icon="video"
              label="Video entries"
              value={entryPagination?.totalItems}
              detail="Submitted by participants"
              tone="violet"
            />
            <SummaryCard
              icon="grid"
              label="Awaiting review"
              value={
                entries.filter(
                  (row) =>
                    row.submissionStatus === 'submitted' ||
                    row.submissionStatus === 'under_review',
                ).length
              }
              detail="On this page"
              tone="amber"
            />
            <SummaryCard
              icon="spark"
              label="Confirmed"
              value={
                registrations.filter(
                  (row) => row.registrationStatus === 'confirmed',
                ).length
              }
              detail="On this page"
              tone="green"
            />
          </section>

          {view === 'overview' ? (
            <div className="overview-columns">
              <section className="panel">
                <SectionHeading
                  title="Recent registrations"
                  subtitle="The latest participants joining competitions"
                  action={
                    <button
                      className="text-link"
                      onClick={() => setView('registrations')}
                    >
                      View all <Icon name="chevron" size={14} />
                    </button>
                  }
                />
                <RegistrationTable
                  rows={filteredRegistrations.slice(0, 6)}
                  loading={registrationLoading}
                  error={registrationError}
                  onRetry={() => void loadRegistrations(registrationPage)}
                  updatingPayment={updatingPayment}
                  onVerifyPayment={verifyPayment}
                />
              </section>

              <section className="panel">
                <SectionHeading
                  title="Recent submissions"
                  subtitle="Review participant video entries"
                  action={
                    <button
                      className="text-link"
                      onClick={() => setView('entries')}
                    >
                      View all <Icon name="chevron" size={14} />
                    </button>
                  }
                />
                <EntryTable
                  rows={filteredEntries.slice(0, 6)}
                  loading={entryLoading}
                  error={entryError}
                  updatingEntry={updatingEntry}
                  onStatusChange={updateEntryStatus}
                  onRetry={() => void loadEntries(entryPage)}
                />
              </section>
            </div>
          ) : view === 'registrations' ? (
            <section className="panel full-panel">
              <SectionHeading
                title="All registrations"
                subtitle="Participant registrations across your competitions"
                action={
                  <FilterSelect
                    label="Registration status"
                    value={registrationFilter}
                    options={REGISTRATION_STATUSES}
                    onChange={(value) => {
                      setRegistrationFilter(value)
                      void loadRegistrations(1, value)
                    }}
                  />
                }
              />

              <RegistrationTable
                rows={filteredRegistrations}
                loading={registrationLoading}
                error={registrationError}
                onRetry={() => void loadRegistrations(registrationPage)}
                updatingPayment={updatingPayment}
                onVerifyPayment={verifyPayment}
              />

              <PaginationBar
                pagination={registrationPagination}
                onPage={(page) => void loadRegistrations(page)}
              />
            </section>
          ) : (
            <section className="panel full-panel">
              <SectionHeading
                title="Video submissions"
                subtitle="Review and update participant entry status"
                action={
                  <FilterSelect
                    label="Submission status"
                    value={entryFilter}
                    options={ENTRY_STATUSES}
                    onChange={(value) => {
                      setEntryFilter(value)
                      void loadEntries(1, value)
                    }}
                  />
                }
              />

              <EntryTable
                rows={filteredEntries}
                loading={entryLoading}
                error={entryError}
                updatingEntry={updatingEntry}
                onStatusChange={updateEntryStatus}
                onRetry={() => void loadEntries(entryPage)}
              />

              <PaginationBar
                pagination={entryPagination}
                onPage={(page) => void loadEntries(page)}
              />
            </section>
          )}

          <footer className="page-footer">
            <span>Feedants Admin</span>
            <span>Competition operations workspace</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

function LoginPage({
  onLogin,
  expired,
}: {
  onLogin: (token: string) => void
  expired: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(
    expired ? 'Your session expired. Sign in to continue.' : '',
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await readResponse<{
        token: string
        tokenType: string
        expiresIn: number
      }>(response)

      if (
        !data.token ||
        data.tokenType.toLowerCase() !== 'bearer' ||
        !data.expiresIn
      ) {
        throw new Error('The server returned an invalid login response.')
      }

      onLogin(data.token)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to sign in. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <div className="login-left">
        <a className="brand login-brand" href="#login">
          <span className="brand-mark">
            <Icon name="spark" size={21} />
          </span>
          <span>
            feedants<span className="brand-dot">.</span>
            <small>ADMIN CONSOLE</small>
          </span>
        </a>

        <div className="login-art">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-card art-card-back">
            <span className="art-line short" />
            <span className="art-line" />
            <span className="art-bar" />
          </div>
          <div className="art-card art-card-front">
            <div className="art-card-head">
              <span className="art-badge">
                <Icon name="users" size={17} />
              </span>
              <span>···</span>
            </div>
            <span className="art-muted">TOTAL REGISTRATIONS</span>
            <strong>1,284</strong>
            <div className="art-chart">
              {[28, 44, 37, 62, 52, 70, 56, 83, 67].map(
                (height, index) => (
                  <i
                    style={{ height: `${height}%` }}
                    key={index}
                  />
                ),
              )}
            </div>
            <span className="art-growth">↗ &nbsp;12.8% this month</span>
          </div>
          <div className="art-float">
            <span>✓</span>
            <span>
              <strong>All caught up</strong>
              <small>Review queue is ready</small>
            </span>
          </div>
          <div className="login-copy">
            <span className="eyebrow light-eyebrow">
              YOUR COMPETITION HQ
            </span>
            <h2>
              Great talent.
              <br />
              One clear view.
            </h2>
            <p>
              Keep registrations organized and every submission moving
              forward.
            </p>
          </div>
        </div>

        <div className="login-left-footer">
          © 2026 Feedants <span>Built for your next big event</span>
        </div>
      </div>

      <div className="login-right">
        <div className="login-mobile-brand">
          <span className="brand-mark">
            <Icon name="spark" size={18} />
          </span>
          feedants<span className="brand-dot">.</span>
        </div>

        <div className="login-form-wrap">
          <div className="login-kicker">
            <i /> ADMINISTRATOR ACCESS
          </div>
          <h1>Welcome back</h1>
          <p className="login-subtitle">
            Sign in to manage your competitions and submissions.
          </p>

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@feedants.com"
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />

            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            <button
              className="sign-in-button"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="button-spinner" /> Signing in…
                </>
              ) : (
                <>
                  Sign in to dashboard <span>→</span>
                </>
              )}
            </button>
          </form>

          <div className="secure-note">
            <span>▣</span> Secure, private administrator sign-in
          </div>
        </div>

        <div className="login-right-footer">
          <span>Need access? Contact your workspace owner.</span>
          <a href="mailto:support@feedants.com">Support ↗</a>
        </div>
      </div>
    </main>
  )
}

function NavButton({
  icon,
  active,
  count,
  onClick,
  children,
}: {
  icon: string
  active: boolean
  count?: number
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className={active ? 'nav-link active' : 'nav-link'}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{children}</span>
      {count !== undefined && (
        <small className="nav-count">{count.toLocaleString()}</small>
      )}
    </button>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string
  label: string
  value?: number
  detail: string
  tone: string
}) {
  return (
    <article className="summary-card">
      <span className={`summary-icon ${tone}`}>
        <Icon name={icon} size={19} />
      </span>
      <span className="summary-label">{label}</span>
      <strong className="summary-value">
        {value === undefined ? (
          <span className="skeleton-number" />
        ) : (
          value.toLocaleString()
        )}
      </strong>
      <span className="summary-detail">{detail}</span>
    </article>
  )
}

function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="filter-control">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All statuses</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {pretty(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill status-${status}`}>
      <i />
      {pretty(status)}
    </span>
  )
}

function TableMessage({
  children,
  error,
  onRetry,
}: {
  children: ReactNode
  error?: string
  onRetry?: () => void
}) {
  return (
    <div
      className={error ? 'table-message table-error' : 'table-message'}
      role={error ? 'alert' : 'status'}
    >
      <span className="message-icon">{error ? '!' : '◌'}</span>
      <span>{children}</span>
      {error && onRetry && <button onClick={onRetry}>Try again</button>}
    </div>
  )
}

function RegistrationTable({
  rows,
  loading,
  error,
  onRetry,
  updatingPayment,
  onVerifyPayment,
}: {
  rows: Registration[]
  loading: boolean
  error: string
  onRetry: () => void
  updatingPayment: string
  onVerifyPayment: (id: string) => void
}) {
  if (loading && rows.length === 0) {
    return (
      <TableMessage>
        <span className="spinner" /> Loading registrations…
      </TableMessage>
    )
  }

  if (error && rows.length === 0) {
    return (
      <TableMessage error={error} onRetry={onRetry}>
        {error}
      </TableMessage>
    )
  }

  if (!loading && rows.length === 0) {
    return (
      <TableMessage>
        No registrations found. When participants register, they’ll appear
        here.
      </TableMessage>
    )
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>PARTICIPANT</th>
            <th>COMPETITION</th>
            <th>REGISTRATION</th>
            <th>PAYMENT</th>
            <th>DATE</th>
            <th>ACTION</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>
                <div className="person-cell">
                  <span className="person-avatar">
                    {row.participantName?.slice(0, 1).toUpperCase() || '?'}
                  </span>
                  <span>
                    <strong>
                      {row.participantName || 'Unknown participant'}
                    </strong>
                    <small>{row.email}</small>
                  </span>
                </div>
              </td>

              <td>
                <span className="competition-name">
                  {row.competition?.title || 'Competition unavailable'}
                </span>
                <small className="subtle-cell">
                  {row.competition?.slug || '—'}
                </small>
              </td>

              <td>
                <StatusPill status={row.registrationStatus} />
              </td>

              <td>
                <StatusPill status={row.paymentStatus} />
              </td>

              <td className="date-cell">{date(row.createdAt)}</td>

              <td>
                {row.paymentStatus === 'pending' &&
                row.registrationStatus !== 'cancelled' ? (
                  <button
                    className="text-link"
                    disabled={updatingPayment === row._id}
                    onClick={() => onVerifyPayment(row._id)}
                  >
                    {updatingPayment === row._id
                      ? 'Verifying…'
                      : 'Verify payment'}
                  </button>
                ) : (
                  <span className="subtle-cell">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && (
        <div className="table-loading">
          <span className="spinner" /> Refreshing…
        </div>
      )}

      {error && (
        <div className="table-inline-error" role="alert">
          {error} <button onClick={onRetry}>Retry</button>
        </div>
      )}
    </div>
  )
}

function EntryTable({
  rows,
  loading,
  error,
  updatingEntry,
  onStatusChange,
  onRetry,
}: {
  rows: Entry[]
  loading: boolean
  error: string
  updatingEntry: string
  onStatusChange: (id: string, status: EntryStatus) => void
  onRetry: () => void
}) {
  if (loading && rows.length === 0) {
    return (
      <TableMessage>
        <span className="spinner" /> Loading video submissions…
      </TableMessage>
    )
  }

  if (error && rows.length === 0) {
    return (
      <TableMessage error={error} onRetry={onRetry}>
        {error}
      </TableMessage>
    )
  }

  if (!loading && rows.length === 0) {
    return (
      <TableMessage>
        No video submissions found. New entries will appear here.
      </TableMessage>
    )
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>PARTICIPANT</th>
            <th>SUBMISSION</th>
            <th>COMPETITION</th>
            <th>REVIEW STATUS</th>
            <th>SUBMITTED</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>
                <div className="person-cell">
                  <span className="person-avatar violet-avatar">
                    {row.participantName?.slice(0, 1).toUpperCase() || '?'}
                  </span>
                  <span>
                    <strong>
                      {row.participantName ||
                        row.registration?.participantName ||
                        'Unknown participant'}
                    </strong>
                    <small>
                      {row.email || row.registration?.email || '—'}
                    </small>
                  </span>
                </div>
              </td>

              <td>
                <span
                  className="file-name"
                  title={row.video.originalFileName}
                >
                  <Icon name="video" size={15} />
                  {row.video.originalFileName}
                </span>
                <small className="subtle-cell">
                  {fileSize(row.video.fileSize)}
                </small>
              </td>

              <td>
                <span className="competition-name">
                  {row.competitionSlug}
                </span>
              </td>

              <td>
                <select
                  className={`status-select status-${row.submissionStatus}`}
                  aria-label={`Review status for ${row.participantName}`}
                  value={row.submissionStatus}
                  disabled={updatingEntry === row._id}
                  onChange={(event) =>
                    onStatusChange(
                      row._id,
                      event.target.value as EntryStatus,
                    )
                  }
                >
                  {ENTRY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {pretty(status)}
                    </option>
                  ))}
                </select>

                {updatingEntry === row._id && (
                  <small className="updating-label">Saving…</small>
                )}
              </td>

              <td className="date-cell">{date(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && (
        <div className="table-loading">
          <span className="spinner" /> Refreshing…
        </div>
      )}

      {error && (
        <div className="table-inline-error" role="alert">
          {error} <button onClick={onRetry}>Retry</button>
        </div>
      )}
    </div>
  )
}

function PaginationBar({
  pagination,
  onPage,
}: {
  pagination: Pagination | null
  onPage: (page: number) => void
}) {
  if (!pagination) return null

  const start =
    pagination.totalItems === 0
      ? 0
      : (pagination.page - 1) * pagination.limit + 1

  const end = Math.min(
    pagination.page * pagination.limit,
    pagination.totalItems,
  )

  return (
    <div className="pagination">
      <span>
        Showing <strong>{start}–{end}</strong> of{' '}
        <strong>{pagination.totalItems.toLocaleString()}</strong>
      </span>

      <div className="pagination-actions">
        <button
          disabled={pagination.page <= 1}
          onClick={() => onPage(pagination.page - 1)}
        >
          ← <span>Previous</span>
        </button>

        <span className="page-number">
          {pagination.page} <small>of</small>{' '}
          {Math.max(1, pagination.totalPages)}
        </span>

        <button
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPage(pagination.page + 1)}
        >
          <span>Next</span> →
        </button>
      </div>
    </div>
  )
}

export default App