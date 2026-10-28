// client/components/kpi/KpiCardGrid.tsx
'use client';

import React from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  Minus,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { KpiMetrics } from '@/types/dashboard.types';

interface KpiCardGridProps {
  kpis: KpiMetrics | null;
  loading?: boolean;
}

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value || 0);
};

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value || 0);
};

export const KpiCardGrid: React.FC<KpiCardGridProps> = ({
  kpis,
  loading = false,
}) => {
  if (loading || !kpis) {
    return (
      <section
        id="kpi-overview"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-24 rounded bg-slate-200" />
              <div className="h-9 w-9 rounded-xl bg-slate-100" />
            </div>
            <div className="mt-4 h-7 w-32 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-20 rounded bg-slate-100" />
          </div>
        ))}
      </section>
    );
  }

  const growth = Number(kpis.revenueGrowth ?? 0);
  const isPositive = growth > 0;
  const isNegative = growth < 0;

  const cards = [
    {
      title: 'Total Revenue',
      value: formatCurrency(kpis.totalRevenue),
      subtitle: 'Gross validated sales volume',
      icon: DollarSign,
      iconBg: 'bg-indigo-50 text-indigo-600',
    },
    {
      title: 'Total Orders',
      value: formatNumber(kpis.totalOrders),
      subtitle: 'Distinct order IDs processed',
      icon: ShoppingBag,
      iconBg: 'bg-sky-50 text-sky-600',
    },
    {
      title: 'Total Customers',
      value: formatNumber(kpis.totalCustomers),
      subtitle: 'Unique active buyer accounts',
      icon: Users,
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Average Order Value',
      value: formatCurrency(kpis.averageOrderValue),
      subtitle: 'Revenue ÷ Distinct Orders',
      icon: Wallet,
      iconBg: 'bg-violet-50 text-violet-600',
    },
  ];

  return (
    <section
      id="kpi-overview"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 scroll-mt-28"
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.title}
            className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {card.title}
              </span>
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.iconBg}`}
              >
                <Icon className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3">
              <p className="text-2xl font-bold tracking-tight text-slate-900">
                {card.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{card.subtitle}</p>
            </div>
          </div>
        );
      })}

      {/* 5th Card: Monthly Revenue Growth % */}
      <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Revenue Growth
          </span>
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-xl ${
              isPositive
                ? 'bg-emerald-50 text-emerald-600'
                : isNegative
                ? 'bg-rose-50 text-rose-600'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            <TrendingUp className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <p
              className={`text-2xl font-bold tracking-tight ${
                isPositive
                  ? 'text-emerald-600'
                  : isNegative
                  ? 'text-rose-600'
                  : 'text-slate-900'
              }`}
            >
              {isPositive ? '+' : ''}
              {growth.toFixed(1)}%
            </p>

            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                isPositive
                  ? 'bg-emerald-50 text-emerald-700'
                  : isNegative
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
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
        </div>
      </div>
    </section>
  );
};