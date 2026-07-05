import { useState, useCallback } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { request, SystemRoles } from 'librechat-data-provider';
import {
  Coins,
  Loader2,
  Activity,
  ArrowLeft,
  RefreshCw,
  ServerCog,
  HeartPulse,
  ListOrdered,
} from 'lucide-react';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

/**
 * Admin-only gateway dashboard backed by the /api/gateway/* proxy (server-side
 * LiteLLM admin API; the master key never reaches the browser). Rendering is
 * deliberately defensive: LiteLLM response shapes drift between versions.
 *
 * Provider health is behind an explicit button because LiteLLM's /health pings
 * every deployment — including serverless GPU routes, which cold-start billed
 * workers.
 */

type SpendLog = {
  request_id?: string;
  model?: string;
  spend?: number;
  total_tokens?: number;
  startTime?: string;
};

type ModelInfo = {
  model_name?: string;
  litellm_params?: { model?: string };
  model_info?: { id?: string };
};

type HealthEndpoint = { model?: string; error?: string };

type HealthReport = {
  healthy_endpoints?: HealthEndpoint[];
  unhealthy_endpoints?: HealthEndpoint[];
  healthy_count?: number;
  unhealthy_count?: number;
};

type SpendTotals = { spend?: number; total_spend?: number };

type ModelAggregate = { count: number; spend: number; tokens: number };

const num = (v: number | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0);

const fmtUSD = (v: number) =>
  v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toFixed(4)}` : '$0.00';

const fmtTime = (iso?: string) => {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const unwrapList = <T,>(raw: { data?: T[] } | T[] | undefined): T[] => {
  if (Array.isArray(raw)) {
    return raw;
  }
  return raw?.data ?? [];
};

function Section({
  icon,
  title,
  actions,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-light bg-surface-primary p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="flex-1 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  const message =
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (error as Error)?.message ??
    'request failed';
  return <p className="text-sm text-red-500">{String(message)}</p>;
}

function Spinner() {
  return <Loader2 className="h-5 w-5 animate-spin text-text-secondary" aria-hidden="true" />;
}

export default function GatewayDashboard() {
  const localize = useLocalize();
  const { user, isAuthenticated } = useAuthContext();
  const isAdmin = isAuthenticated && user?.role === SystemRoles.ADMIN;

  const modelsQuery = useQuery({
    queryKey: ['gateway', 'models'],
    queryFn: () => request.get('/api/gateway/models'),
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const spendQuery = useQuery({
    queryKey: ['gateway', 'spend'],
    queryFn: () => request.get('/api/gateway/spend'),
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const logsQuery = useQuery({
    queryKey: ['gateway', 'logs'],
    queryFn: () => request.get('/api/gateway/logs'),
    staleTime: 30_000,
    enabled: isAdmin,
  });

  const [healthRequested, setHealthRequested] = useState(false);
  const healthQuery = useQuery({
    queryKey: ['gateway', 'health'],
    queryFn: () => request.get('/api/gateway/health'),
    enabled: isAdmin && healthRequested,
    staleTime: Infinity,
    retry: false,
  });

  const refreshAll = useCallback(() => {
    modelsQuery.refetch();
    spendQuery.refetch();
    logsQuery.refetch();
  }, [modelsQuery, spendQuery, logsQuery]);

  const runHealthCheck = useCallback(() => {
    if (healthRequested) {
      healthQuery.refetch();
      return;
    }
    setHealthRequested(true);
  }, [healthRequested, healthQuery]);

  if (!isAuthenticated) {
    return null;
  }
  if (user != null && user.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace={true} />;
  }

  const models = unwrapList<ModelInfo>(modelsQuery.data);

  const spendRaw = spendQuery.data as SpendTotals | SpendTotals[] | undefined;
  const totalSpend = Array.isArray(spendRaw)
    ? spendRaw.reduce((acc, row) => acc + num(row.spend), 0)
    : num(spendRaw?.spend) + num(spendRaw?.total_spend);

  const logs = unwrapList<SpendLog>(logsQuery.data)
    .slice()
    .sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''));

  const byModel = new Map<string, ModelAggregate>();
  for (const log of logs) {
    const key = log.model || 'unknown';
    const agg = byModel.get(key) ?? { count: 0, spend: 0, tokens: 0 };
    agg.count += 1;
    agg.spend += num(log.spend);
    agg.tokens += num(log.total_tokens);
    byModel.set(key, agg);
  }
  const maxModelSpend = Math.max(1e-9, ...[...byModel.values()].map((v) => v.spend));

  const health = healthQuery.data as HealthReport | undefined;
  const isRefreshing = modelsQuery.isFetching || spendQuery.isFetching || logsQuery.isFetching;

  return (
    <div className="h-full w-full overflow-y-auto bg-surface-secondary">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/c/new"
            className="flex items-center gap-1 rounded-lg border border-border-light px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {localize('com_ui_chat')}
          </Link>
          <ServerCog className="h-6 w-6 text-text-primary" aria-hidden="true" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-text-primary">
              {localize('com_ui_gateway_dashboard')}
            </h1>
            <p className="text-xs text-text-secondary">{localize('com_ui_gateway_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {localize('com_ui_refresh')}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Section
            icon={<Coins className="h-4 w-4 text-text-secondary" aria-hidden="true" />}
            title={localize('com_ui_gateway_total_spend')}
          >
            {spendQuery.isLoading ? (
              <Spinner />
            ) : spendQuery.isError ? (
              <ErrorNote error={spendQuery.error} />
            ) : (
              <p className="text-3xl font-semibold text-text-primary">{fmtUSD(totalSpend)}</p>
            )}
            <p className="mt-1 text-xs text-text-secondary">
              {localize('com_ui_gateway_spend_note')}
            </p>
          </Section>

          <Section
            icon={<Activity className="h-4 w-4 text-text-secondary" aria-hidden="true" />}
            title={`${localize('com_ui_gateway_routes')} (${models.length})`}
          >
            {modelsQuery.isLoading ? (
              <Spinner />
            ) : modelsQuery.isError ? (
              <ErrorNote error={modelsQuery.error} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {models.map((model, i) => (
                  <span
                    key={model.model_info?.id ?? i}
                    className="rounded-full border border-border-light bg-surface-secondary px-3 py-1 text-sm text-text-primary"
                    title={model.litellm_params?.model ?? ''}
                  >
                    {model.model_name ?? '?'}
                    <span className="ml-1.5 text-xs text-text-secondary">
                      {(model.litellm_params?.model ?? '').split('/')[0]}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="mt-4">
          <Section
            icon={<Coins className="h-4 w-4 text-text-secondary" aria-hidden="true" />}
            title={localize('com_ui_gateway_spend_by_model')}
          >
            {logsQuery.isLoading ? (
              <Spinner />
            ) : logsQuery.isError ? (
              <ErrorNote error={logsQuery.error} />
            ) : byModel.size === 0 ? (
              <p className="text-sm text-text-secondary">
                {localize('com_ui_gateway_no_requests')}
              </p>
            ) : (
              <div className="space-y-2">
                {[...byModel.entries()]
                  .sort((a, b) => b[1].spend - a[1].spend)
                  .map(([model, agg]) => (
                    <div key={model} className="flex items-center gap-3">
                      <span className="w-40 truncate text-sm text-text-primary" title={model}>
                        {model}
                      </span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-surface-tertiary">
                        <div
                          className="h-full rounded bg-green-500/70"
                          style={{ width: `${Math.max(2, (agg.spend / maxModelSpend) * 100)}%` }}
                        />
                      </div>
                      <span className="w-20 text-right text-sm tabular-nums text-text-primary">
                        {fmtUSD(agg.spend)}
                      </span>
                      <span className="w-28 text-right text-xs tabular-nums text-text-secondary">
                        {agg.count} req · {agg.tokens.toLocaleString()} tok
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Section>
        </div>

        <div className="mt-4">
          <Section
            icon={<HeartPulse className="h-4 w-4 text-text-secondary" aria-hidden="true" />}
            title={localize('com_ui_gateway_health')}
            actions={
              <button
                type="button"
                onClick={runHealthCheck}
                className="rounded-lg border border-border-light px-3 py-1 text-xs text-text-primary hover:bg-surface-hover"
              >
                {healthQuery.isFetching
                  ? localize('com_ui_gateway_health_checking')
                  : localize('com_ui_gateway_health_run')}
              </button>
            }
          >
            {!healthRequested ? (
              <p className="text-sm text-text-secondary">
                {localize('com_ui_gateway_health_note')}
              </p>
            ) : healthQuery.isFetching ? (
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {localize('com_ui_gateway_health_pinging')}
              </p>
            ) : healthQuery.isError ? (
              <ErrorNote error={healthQuery.error} />
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {(health?.healthy_endpoints ?? []).map((endpoint, i) => (
                    <span
                      key={`healthy-${i}`}
                      className="rounded-full bg-green-500/15 px-3 py-1 text-sm text-green-600 dark:text-green-400"
                    >
                      ● {endpoint.model ?? 'endpoint'}
                    </span>
                  ))}
                  {(health?.unhealthy_endpoints ?? []).map((endpoint, i) => (
                    <span
                      key={`unhealthy-${i}`}
                      className="rounded-full bg-red-500/15 px-3 py-1 text-sm text-red-600 dark:text-red-400"
                      title={endpoint.error ?? ''}
                    >
                      ● {endpoint.model ?? 'endpoint'}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-text-secondary">
                  {num(health?.healthy_count)} {localize('com_ui_gateway_healthy')} ·{' '}
                  {num(health?.unhealthy_count)} {localize('com_ui_gateway_unhealthy')}
                </p>
              </div>
            )}
          </Section>
        </div>

        <div className="mt-4">
          <Section
            icon={<ListOrdered className="h-4 w-4 text-text-secondary" aria-hidden="true" />}
            title={localize('com_ui_gateway_recent')}
          >
            {logsQuery.isLoading ? (
              <Spinner />
            ) : logsQuery.isError ? (
              <ErrorNote error={logsQuery.error} />
            ) : logs.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {localize('com_ui_gateway_no_requests')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-light text-xs uppercase tracking-wide text-text-secondary">
                      <th className="py-2 pr-4">{localize('com_ui_gateway_time')}</th>
                      <th className="py-2 pr-4">{localize('com_ui_gateway_model')}</th>
                      <th className="py-2 pr-4 text-right">{localize('com_ui_gateway_tokens')}</th>
                      <th className="py-2 text-right">{localize('com_ui_gateway_spend')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.slice(0, 25).map((log, i) => (
                      <tr
                        key={log.request_id ?? i}
                        className="border-b border-border-light/50 text-text-primary"
                      >
                        <td className="py-1.5 pr-4 text-xs text-text-secondary">
                          {fmtTime(log.startTime)}
                        </td>
                        <td className="py-1.5 pr-4">{log.model ?? '—'}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {num(log.total_tokens).toLocaleString()}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUSD(num(log.spend))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
