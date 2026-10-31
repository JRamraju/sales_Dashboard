// client/components/layout/Sidebar.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  PieChart,
  ShieldAlert,
  TrendingUp,
  UploadCloud,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useFilterContext } from '@/context/FilterContext';
import { useScrollSpy } from '@/hooks/useScrollSpy';
import { enterClass } from '@/components/layout/AnimateIn';
import { lockScroll } from '@/lib/smoothScroll';

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
  {
    id: 'new-records',
    label: 'New Customers & Products',
    href: '#new-records',
    icon: UserPlus,
  },
];

/** Section element ids, in page order (top to bottom, left to right). */
const SECTION_IDS = NAV_ITEMS.map((item) => item.href.slice(1));

/** DOM id of the mobile drawer (referenced by the header hamburger's aria-controls). */
export const MOBILE_NAV_ID = 'mobile-nav-drawer';

interface SidebarProps {
  /** Mobile drawer open state (owned by the page so the header can toggle it). */
  open: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  const {
    activeBatch,
    scopeBatches,
    isAllFiles,
    batches,
    openUploadModal,
    openValidationModal,
  } = useFilterContext();

  const scopeValid = scopeBatches.reduce((n, b) => n + b.validRowsInserted, 0);
  const scopeSkipped = scopeBatches.reduce((n, b) => n + b.invalidRowsCount, 0);
  const scopeTitle = activeBatch
    ? `${activeBatch.fileNumber ? `File ${activeBatch.fileNumber} · ` : ''}${activeBatch.fileName}`
    : isAllFiles
    ? `All files (${scopeBatches.length})`
    : `${scopeBatches.length} files selected`;

  const { activeId, scrollToSection } = useScrollSpy(SECTION_IDS);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleNavClick = (href: string) => {
    const id = href.slice(1);
    onClose();
    if (open) {
      // Next tick: the drawer's scroll lock (which stops Lenis) is released as
      // the drawer closes, and Lenis would cancel a glide started before that.
      window.setTimeout(() => scrollToSection(id), 0);
    } else {
      scrollToSection(id);
    }
  };

  // Drawer behaviour: lock page scroll, close on Escape, move focus inside.
  useEffect(() => {
    if (!open) return;

    const releaseScrollLock = lockScroll();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep keyboard focus inside the open drawer (aria-modal).
      const dialog = document.getElementById(MOBILE_NAV_ID);
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      const outside = !current || !dialog.contains(current);
      if (event.shiftKey && (current === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      releaseScrollLock();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  // Rendered twice (mobile drawer + desktop aside). Only the drawer copy gets
  // the close button and its ref, so focus never lands on a hidden element.
  const renderSidebar = (isDrawer: boolean) => (
    <div className="flex h-full w-full flex-col justify-between bg-slate-900 text-slate-100 select-none">
      {/* Top Brand Header */}
      <div>
        <div
          className={`flex items-center justify-between gap-2 py-5 border-b border-slate-800 ${
            isDrawer ? 'px-4' : 'px-6'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-600/30">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white block leading-none">
                SalesPulse BI
              </span>
              <span className="whitespace-nowrap text-[11px] text-slate-400 font-medium">
                ETL & Forecasting Engine
              </span>
            </div>
          </div>

          {isDrawer && (
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Quick Upload CTA */}
        <div className="p-4">
          <button
            type="button"
            onClick={() => {
              onClose();
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
              const isActive = activeId === item.href.slice(1);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => handleNavClick(item.href)}
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
        {scopeBatches.length > 0 ? (
          <div className="rounded-xl bg-slate-800/90 p-3.5 border border-slate-700/70">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="truncate" title={scopeTitle}>
                {scopeTitle}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {isAllFiles && scopeBatches.length > 1
                ? 'Running dataset: all files combined'
                : activeBatch
                ? 'Viewing one file'
                : 'Viewing selected files'}
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-slate-900/70 p-2">
                <span className="text-slate-400 block">Valid Rows</span>
                <span className="font-bold text-emerald-400 text-xs">
                  {scopeValid.toLocaleString()}
                </span>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <span className="text-slate-400 block">Skipped</span>
                <span
                  className={`font-bold text-xs ${
                    scopeSkipped > 0 ? 'text-amber-400' : 'text-slate-300'
                  }`}
                >
                  {scopeSkipped.toLocaleString()}
                </span>
              </div>
            </div>

            {activeBatch && activeBatch.invalidRowsCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openValidationModal(activeBatch._id);
                }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Inspect Skipped Rows</span>
              </button>
            )}
            {!activeBatch && scopeSkipped > 0 && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                Pick a single file in the header to inspect its skipped rows.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-800/50 p-3.5 border border-slate-800 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-medium text-slate-300 mb-1">
              <Database className="h-4 w-4 text-slate-400" />
              <span>No Files Yet</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Upload a CSV or Excel sales file to run the ETL pipeline.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span> Uploaded files: {batches.length}</span>
          </span>
          <span className="text-slate-500">v1.0</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile drawer: stays mounted so it can slide in from the RIGHT.
          The trigger button lives in TopFilterBar (top-right corner). */}
      <div
        className={`fixed inset-0 z-50 lg:hidden ${
          open ? '' : 'pointer-events-none'
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <div
          className={`absolute inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onClose}
        />
        <div
          id={MOBILE_NAV_ID}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className={`fixed inset-y-0 right-0 z-50 w-64 max-w-[85vw] transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            open ? 'translate-x-0 shadow-2xl' : 'translate-x-full pointer-events-none'
          }`}
        >
          {renderSidebar(true)}
        </div>
      </div>

      {/* Desktop Fixed Sidebar */}
      <aside
        className={`hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64 ${enterClass(
          'left'
        )}`}
      >
        {renderSidebar(false)}
      </aside>
    </>
  );
};