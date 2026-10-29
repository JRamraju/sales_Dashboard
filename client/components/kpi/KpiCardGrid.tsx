// client/components/kpi/KpiCardGrid.tsx
'use client';

import React from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  IndianRupee,
  Minus,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { KpiMetrics } from '@/types/dashboard.types';
import { formatINR, formatNumber } from '@/lib/format';
import { enterClass, enterDelay } from '@/components/layout/AnimateIn';

interface KpiCardGridProps {
  kpis: KpiMetrics | null;
  loading?: boolean;
}

const formatCurrency = (value: number): string =>
  formatINR(value, { maximumFractionDigits: value >= 1000 ? 0 : 2 });

const CARD_BASE =
  'flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-shadow hover:shadow-md';

export const KpiCardGrid: React.FC<KpiCardGridProps> = ({
  kpis,
  loading = false,
}) => {
  const showSkeleton = loading || !kpis;

  const growth = Number(kpis?.revenueGrowth ?? 0);
  const isPositive = growth > 0;
  const isNegative = growth < 0;

  // The 5 cards are always rendered (skeleton content swaps in place) so the
  // one-time entrance animation never replays when filters trigger a reload.
  const cards = [
    {
      title: 'Total Revenue',
      value: kpis ? formatCurrency(kpis.totalRevenue) : '',
      subtitle: 'Gross validated sales volume',
      icon: IndianRupee,
      iconBg: 'bg-indigo-50 text-indigo-600',
    },
    {
      title: 'Total Orders',
      value: kpis ? formatNumber(kpis.totalOrders) : '',
      subtitle: 'Distinct order IDs processed',
      icon: ShoppingBag,
      iconBg: 'bg-sky-50 text-sky-600',
    },
    {
      title: 'Total Customers',
      value: kpis ? formatNumber(kpis.totalCustomers) : '',
      subtitle: 'Unique active buyer accounts',
      icon: Users,
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Average Order Value',
      value: kpis ? formatCurrency(kpis.averageOrderValue) : '',
      subtitle: 'Revenue ÷ Distinct Orders',
      icon: Wallet,
      iconBg: 'bg-violet-50 text-violet-600',
    },
  ];

  const growthIconBg = isPositive
    ? 'bg-emerald-50 text-emerald-600'
    : isNegative
    ? 'bg-rose-50 text-rose-600'
    : 'bg-slate-100 text-slate-600';

  const growthTextColor = isPositive
    ? 'text-emerald-600'
    : isNegative
    ? 'text-rose-600'
    : 'text-slate-900';

  const growthBadge = isPositive
    ? 'bg-emerald-50 text-emerald-700'
    : isNegative
    ? 'bg-rose-50 text-rose-700'
    : 'bg-slate-100 text-slate-600';

  return (
    <section
      id="kpi-overview"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 scroll-target"
      aria-busy={showSkeleton}
    >
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div
            key={card.title}
            className={`${CARD_BASE} ${enterClass(index % 2 === 0 ? 'left' : 'right')}`}
            style={enterDelay(index * 80)}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase leading-snug tracking-wide text-slate-500 xl:text-xs">
                {card.title}
              </span>
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${card.iconBg}`}
              >
                <Icon className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3 min-w-0">
              {showSkeleton ? (
                <>
                  <div className="h-8 w-32 max-w-full animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-20 animate-pulse rounded bg-slate-100" />
                </>
              ) : (
                <>
                  <p
                    className="truncate text-xl font-bold tracking-tight text-slate-900 2xl:text-2xl"
                    title={card.value}
                  >
                    {card.value}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {card.subtitle}
                  </p>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* 5th Card: Revenue Growth % */}
      <div
        className={`${CARD_BASE} ${enterClass('left')}`}
        style={enterDelay(4 * 80)}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase leading-snug tracking-wide text-slate-500 xl:text-xs">
            Revenue Growth
          </span>
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              showSkeleton ? 'bg-slate-100 text-slate-400' : growthIconBg
            }`}
          >
            <TrendingUp className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 min-w-0">
          {showSkeleton ? (
            <>
              <div className="h-8 w-28 max-w-full animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p
                  className={`text-xl font-bold tracking-tight 2xl:text-2xl ${growthTextColor}`}
                >
                  {isPositive ? '+' : ''}
                  {growth.toFixed(1)}%
                </p>

                <span
                  className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${growthBadge}`}
                >
                  {isPositive ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : isNegative ? (
                    <ArrowDownRight className="h-3 w-3" />
                  ) : (
                    <Minus className="h-3 w-3" />
                  )}
                  {isPositive ? 'Upward' : isNegative ? 'Downward' : 'Flat'}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-slate-500">
                Period-over-period momentum
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
