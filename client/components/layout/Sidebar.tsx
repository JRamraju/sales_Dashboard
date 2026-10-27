// client/components/layout/Sidebar.tsx
'use client';

import React, { useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  PieChart,
  ShieldAlert,
  TrendingUp,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { useFilterContext } from '@/context/FilterContext';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'KPI Overview',
    href: '#kpi-overview',
    icon: LayoutDashboard,
  },
  {
    id: 'trends',
    label: 'Revenue Trends',
    href: '#revenue-trends',
    icon: TrendingUp,
  },
  {
    id: 'forecast',
    label: 'Sales Forecast (3M)',
    href: '#sales-forecast',
    icon: BarChart3,
  },
  {
    id: 'distributions',
    label: 'Category & Region',
    href: '#category-region',
    icon: PieChart,
  },
  {
    id: 'leaderboards',
    label: 'Products & Customers',
    href: '#leaderboards',
    icon: Users,
  },
];

export const Sidebar: React.FC = () => {
  const {
    activeBatch,
    batches,
    openUploadModal,
    openValidationModal,
  } = useFilterContext();

  const [activeNav, setActiveNav] = useState<string>('overview');
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  const handleNavClick = (id: string, href: string) => {
    setActiveNav(id);
    setMobileOpen(false);
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-slate-900 text-slate-100 w-64 select-none">
      {/* Top Brand Header */}
      <div>
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-600/30">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white block leading-none">
                SalesPulse BI
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                ETL & Forecasting Engine
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Quick Upload CTA */}
        <div className="p-4">
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              openUploadModal();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700 transition-all cursor-pointer"
          >
            <UploadCloud className="h-4 w-4" />
            <span>Upload CSV / Excel</span>
          </button>
        </div>

        {/* Navigation Links */}
        <div className="px-3 py-2">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Analytics Modules
          </p>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id, item.href)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-slate-800 text-white border-l-4 border-indigo-500 pl-2'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${
                      isActive ? 'text-indigo-400' : 'text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Active Dataset Card */}
      <div className="p-4 border-t border-slate-800 space-y-3">
        {activeBatch ? (
          <div className="rounded-xl bg-slate-800/90 p-3.5 border border-slate-700/70">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="truncate" title={activeBatch.fileName}>
                {activeBatch.fileName}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-slate-900/70 p-2">
                <span className="text-slate-400 block">Valid Rows</span>
                <span className="font-bold text-emerald-400 text-xs">
                  {activeBatch.validRowsInserted.toLocaleString()}
                </span>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <span className="text-slate-400 block">Quarantined</span>
                <span
                  className={`font-bold text-xs ${
                    activeBatch.invalidRowsCount > 0
                      ? 'text-amber-400'
                      : 'text-slate-300'
                  }`}
                >
                  {activeBatch.invalidRowsCount.toLocaleString()}
                </span>
              </div>
            </div>

            {activeBatch.invalidRowsCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  openValidationModal();
                }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Inspect Skipped Rows</span>
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-800/50 p-3.5 border border-slate-800 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-medium text-slate-300 mb-1">
              <Database className="h-4 w-4 text-slate-400" />
              <span>No Dataset Selected</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Upload a CSV or Excel sales file to run the ETL pipeline.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span> Stored Batches: {batches.length}</span>
          </span>
          <span className="text-slate-500">v1.0</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Hamburger Trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg lg:hidden hover:bg-indigo-500"
        aria-label="Open navigation menu"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* Mobile Backdrop Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 flex h-full">{sidebarContent}</div>
        </div>
      )}

      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64">
        {sidebarContent}
      </aside>
    </>
  );
};