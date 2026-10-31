// client/app/page.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { AlertCircle, RefreshCw } from 'lucide-react';
import {
  fetchFullDashboardData,
  FullDashboardBundle,
} from '@/api/analytics.api';
import { useFilterContext } from '@/context/FilterContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopFilterBar } from '@/components/layout/TopFilterBar';
import { AnimateIn } from '@/components/layout/AnimateIn';
import {
  useWelcomeIntro,
  WelcomeSplash,
} from '@/components/layout/WelcomeSplash';
import { FileDropzone } from '@/components/upload/FileDropzone';
import {
  DataHealthBanner,
  ValidationModal,
} from '@/components/upload/ValidationModal';
import { KpiCardGrid } from '@/components/kpi/KpiCardGrid';
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart';
import { ForecastChart } from '@/components/charts/ForecastChart';
import { CategoryPieChart } from '@/components/charts/CategoryPieChart';
import { TopProductsBarChart } from '@/components/charts/TopProductsBarChart';
import { CustomerSalesTable } from '@/components/tables/CustomerSalesTable';
import { NewRecordsPanel } from '@/components/tables/NewRecordsPanel';

export default function DashboardPage() {
  const {
    hasDataset,
    selectedBatchIds,
    datasetVersion,
    isLoadingBatches,
    startDate,
    endDate,
    selectedCategories,
    selectedRegions,
    granularity,
    forecastHorizon,
    setFilterOptions,
  } = useFilterContext();

  const [dashboardData, setDashboardData] =
    useState<FullDashboardBundle | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  // Mobile navigation drawer (opened from the hamburger in TopFilterBar).
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus({ preventScroll: true });
  }, []);

  // First-load welcome splash. "Ready" = the initial load has settled:
  // batches fetched AND (no dataset, or its analytics arrived / failed).
  const initialLoadSettled =
    !isLoadingBatches &&
    (!hasDataset || dashboardData !== null || errorMessage !== null);
  const { showSplash, leaving } = useWelcomeIntro(initialLoadSettled);

  useEffect(() => {
    if (!hasDataset) {
      setDashboardData(null);
      return;
    }

    const controller = new AbortController();
    setIsLoadingAnalytics(true);
    setErrorMessage(null);

    fetchFullDashboardData(
      {
        // Empty = every finished file combined (the running dataset).
        batchIds: selectedBatchIds,
        startDate,
        endDate,
        category: selectedCategories,
        region: selectedRegions,
        granularity,
        horizon: forecastHorizon,
      },
      controller.signal
    )
      .then((bundle) => {
        setDashboardData(bundle);
        if (bundle.overview?.filterOptions) {
          setFilterOptions(bundle.overview.filterOptions);
        }
      })
      .catch((err) => {
        if (axios.isCancel(err) || err?.name === 'CanceledError') {
          return;
        }
        setErrorMessage(
          err?.message || 'Failed to load analytics data.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingAnalytics(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    hasDataset,
    selectedBatchIds,
    datasetVersion,
    startDate,
    endDate,
    selectedCategories,
    selectedRegions,
    granularity,
    forecastHorizon,
    reloadTrigger,
    setFilterOptions,
  ]);

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-50">
      {showSplash && <WelcomeSplash leaving={leaving} />}

      {/* The dashboard mounts as the splash starts fading, so every entrance
          animation plays exactly once, right as the welcome screen clears. */}
      {leaving && (
        <>
          {/* Left Fixed Executive Sidebar (+ mobile drawer) */}
          <Sidebar open={navOpen} onClose={closeNav} />

          {/* Main Content Area */}
          <div className="lg:pl-64 flex flex-col min-h-screen">
            {/* Sticky Top Action & Filter Bar (hamburger lives here below lg) */}
            <TopFilterBar
              onMenuClick={openNav}
              menuOpen={navOpen}
              menuButtonRef={menuButtonRef}
            />

            {/* Page Body */}
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 space-y-6 max-w-[1600px] w-full mx-auto">
              {/* Conditional Data Health Banner */}
              <DataHealthBanner />

              {/* Error Alert Banner */}
              {errorMessage && (
                <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReloadTrigger((n) => n + 1)}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500 cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              {/* Empty State: No Dataset Uploaded Yet */}
              {!isLoadingBatches && !hasDataset ? (
                <AnimateIn direction="left">
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 shadow-2xs">
                    <div className="text-center max-w-md mx-auto mb-2">
                      <h2 className="text-lg font-bold text-slate-900">
                        Welcome to SalesPulse BI
                      </h2>
                      <p className="text-xs text-slate-500 mt-1">
                        Upload your first CSV or Excel sales file below. Every
                        file you add joins one running dataset, so KPIs, charts
                        and the 3-month forecast always cover all of your data.
                      </p>
                    </div>
                    <FileDropzone asModal={false} />
                  </div>
                </AnimateIn>
              ) : (
                <>
                  {/* ROW 1: 5 KPI Summary Cards (stagger in from left / right) */}
                  <KpiCardGrid
                    kpis={dashboardData?.overview.kpis ?? null}
                    loading={isLoadingAnalytics || isLoadingBatches}
                  />

                  {/* ROW 2: Revenue & order trend, full width */}
                  <AnimateIn direction="left" delay={200}>
                    <RevenueTrendChart
                      data={dashboardData?.trends ?? []}
                      loading={isLoadingAnalytics}
                    />
                  </AnimateIn>

                  {/* ROW 3: Forecast (left) + Dimensional Breakdown (right), equal height */}
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <AnimateIn direction="left" delay={280} className="xl:col-span-8">
                      <ForecastChart
                        forecastData={dashboardData?.forecast ?? null}
                        loading={isLoadingAnalytics}
                      />
                    </AnimateIn>

                    <AnimateIn direction="right" delay={360} className="xl:col-span-4">
                      <CategoryPieChart
                        categories={
                          dashboardData?.breakdowns.categoryDistribution ?? []
                        }
                        regions={
                          dashboardData?.breakdowns.regionDistribution ?? []
                        }
                        loading={isLoadingAnalytics}
                      />
                    </AnimateIn>
                  </div>

                  {/* ROW 4: Product & Customer Deep-Dive (50% / 50% Split) */}
                  <div
                    id="leaderboards"
                    className="grid grid-cols-1 gap-6 xl:grid-cols-2 scroll-target"
                  >
                    <AnimateIn direction="left" delay={440}>
                      <TopProductsBarChart
                        products={dashboardData?.breakdowns.topProducts ?? []}
                        loading={isLoadingAnalytics}
                      />
                    </AnimateIn>
                    <AnimateIn direction="right" delay={520}>
                      <CustomerSalesTable
                        customers={dashboardData?.breakdowns.topCustomers ?? []}
                        loading={isLoadingAnalytics}
                      />
                    </AnimateIn>
                  </div>

                  {/* ROW 5: New customers & products per file */}
                  <AnimateIn direction="left" delay={560}>
                    <NewRecordsPanel />
                  </AnimateIn>
                </>
              )}
            </main>
          </div>
        </>
      )}

      {/* Global Modals */}
      <FileDropzone asModal />
      <ValidationModal />
    </div>
  );
}