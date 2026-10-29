// client/components/layout/TopFilterBar.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  Database,
  Filter,
  Globe,
  Layers,
  Menu,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useFilterContext } from '@/context/FilterContext';
import { Granularity } from '@/types/dashboard.types';
import { enterClass } from '@/components/layout/AnimateIn';
import { MOBILE_NAV_ID } from '@/components/layout/Sidebar';

/**
 * Reusable Multi-Select Dropdown for Category and Region Filters
 */
interface MultiSelectDropdownProps {
  label: string;
  icon: React.ElementType;
  options: string[];
  selected: string[];
  onChange: (nextSelected: string[]) => void;
  disabled?: boolean;
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const toggleOption = (item: string) => {
    if (selected.includes(item)) {
      onChange(selected.filter((v) => v !== item));
    } else {
      onChange([...selected, item]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          selected.length > 0
            ? 'border-indigo-500 bg-indigo-50/80 text-indigo-700'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-slate-400" />
          <span>{label}</span>
          {selected.length > 0 && (
            <span className="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
              {selected.length}
            </span>
          )}
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && options.length > 0 && (
        <div className="absolute left-0 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-40">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1.5 px-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Filter by {label}
            </span>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {options.map((option) => {
              const isChecked = selected.includes(option);
              return (
                <label
                  key={option}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleOption(option)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="truncate">{option}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface TopFilterBarProps {
  /** Opens the mobile navigation drawer (hamburger is shown below `lg`). */
  onMenuClick: () => void;
  menuOpen: boolean;
  menuButtonRef?: React.Ref<HTMLButtonElement>;
}

export const TopFilterBar: React.FC<TopFilterBarProps> = ({
  onMenuClick,
  menuOpen,
  menuButtonRef,
}) => {
  const {
    batches,
    activeBatchId,
    activeBatch,
    isLoadingBatches,
    startDate,
    endDate,
    selectedCategories,
    selectedRegions,
    granularity,
    filterOptions,
    hasActiveFilters,
    setActiveBatchId,
    setStartDate,
    setEndDate,
    setSelectedCategories,
    setSelectedRegions,
    setGranularity,
    resetFilters,
    removeBatch,
    openUploadModal,
  } = useFilterContext();

  const [isDeleting, setIsDeleting] = useState(false);
  // Below lg the filter row is collapsed behind a "Filters" toggle, so the
  // sticky header stays compact on phones and tablets.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    selectedCategories.length +
    selectedRegions.length +
    (startDate || endDate ? 1 : 0);
  const headerRef = useRef<HTMLElement>(null);

  // Publish the real (wrapping, responsive) header height so scroll offsets
  // and the scroll-spy activation line always match what is actually on screen.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const publish = () => {
      document.documentElement.style.setProperty(
        '--app-header-h',
        `${Math.round(header.getBoundingClientRect().height)}px`
      );
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--app-header-h');
    };
  }, []);

  const handleDeleteCurrentBatch = async () => {
    if (!activeBatchId || !activeBatch) return;
    const confirmed = window.confirm(
      `Delete dataset "${activeBatch.fileName}" and all of its sales records?`
    );
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      await removeBatch(activeBatchId);
    } catch (error) {
      console.error('Failed to delete batch:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const granularities: { value: Granularity; label: string }[] = [
    { value: 'day', label: 'Daily' },
    { value: 'week', label: 'Weekly' },
    { value: 'month', label: 'Monthly' },
  ];

  return (
    <header
      ref={headerRef}
      className={`sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-md ${enterClass(
        'right'
      )}`}
    >
      <div className="flex flex-col gap-2.5 px-4 py-2.5 sm:gap-3 sm:px-6 sm:py-3 lg:px-8">
        {/* Top Row: Title (+ hamburger below lg), then Dataset Selector & Upload Button */}
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3 lg:flex-1">
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                Executive Sales Analytics Dashboard
              </h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block">
                Real-time MongoDB $facet aggregations & OLS + WMA revenue forecasting
              </p>
            </div>

            {/* Hamburger: top-right corner of the header, below lg only */}
            <button
              ref={menuButtonRef}
              type="button"
              onClick={onMenuClick}
              aria-label="Open navigation menu"
              aria-expanded={menuOpen}
              aria-controls={MOBILE_NAV_ID}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 cursor-pointer lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 lg:shrink-0">
            {/* Dataset Selector Dropdown */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 lg:flex-none">
              <Database className="h-4 w-4 text-indigo-600 shrink-0" />
              <label htmlFor="dataset-selector" className="sr-only">
                Active Dataset
              </label>
              <select
                id="dataset-selector"
                value={activeBatchId}
                disabled={isLoadingBatches || batches.length === 0}
                onChange={(e) => setActiveBatchId(e.target.value)}
                className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer lg:max-w-[210px] lg:flex-none"
              >
                {batches.length === 0 ? (
                  <option value="">No datasets uploaded yet</option>
                ) : (
                  batches.map((batch) => (
                    <option key={batch._id} value={batch._id}>
                      {batch.fileName} ({batch.validRowsInserted.toLocaleString()} rows)
                    </option>
                  ))
                )}
              </select>

              {activeBatchId && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDeleteCurrentBatch}
                  title="Delete selected dataset batch"
                  className="ml-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filters toggle (below lg only) */}
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-controls="header-filters"
              className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer lg:hidden ${
                filtersOpen || activeFilterCount > 0
                  ? 'border-indigo-500 bg-indigo-50/80 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold leading-4 text-white">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  filtersOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Primary Upload Button */}
            <button
              type="button"
              onClick={openUploadModal}
              aria-label="Upload New CSV/Excel"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-500 active:bg-indigo-700 transition-all cursor-pointer sm:px-3.5"
            >
              <Upload className="h-3.5 w-3.5" />
              {/* Icon-only at lg (1024-1279) where the header row is tight */}
              <span className="hidden sm:inline lg:hidden xl:inline">
                Upload New CSV/Excel
              </span>
            </button>
          </div>
        </div>

        {/* Second Row: Date Range, Category, Region, Granularity & Reset */}
        <div
          id="header-filters"
          className={`${
            filtersOpen ? 'flex' : 'hidden'
          } flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 lg:flex`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 hidden items-center gap-1 text-xs font-semibold text-slate-500 lg:inline-flex">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <span>Filters:</span>
            </span>

            {/* Date Range Picker (Start Date -> End Date) */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700">
              <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                aria-label="Start Date"
                value={startDate ?? ''}
                min={filterOptions.minDate ?? undefined}
                max={endDate ?? filterOptions.maxDate ?? undefined}
                disabled={!activeBatchId}
                onChange={(e) => setStartDate(e.target.value || null)}
                className="bg-transparent text-xs text-slate-700 focus:outline-none disabled:opacity-50"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                aria-label="End Date"
                value={endDate ?? ''}
                min={startDate ?? filterOptions.minDate ?? undefined}
                max={filterOptions.maxDate ?? undefined}
                disabled={!activeBatchId}
                onChange={(e) => setEndDate(e.target.value || null)}
                className="bg-transparent text-xs text-slate-700 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Category Multi-Select */}
            <MultiSelectDropdown
              label="Category"
              icon={Layers}
              options={filterOptions.categories}
              selected={selectedCategories}
              onChange={setSelectedCategories}
              disabled={!activeBatchId}
            />

            {/* Region Multi-Select */}
            <MultiSelectDropdown
              label="Region"
              icon={Globe}
              options={filterOptions.regions}
              selected={selectedRegions}
              onChange={setSelectedRegions}
              disabled={!activeBatchId}
            />

            {/* Reset Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>

          {/* Time-Series Granularity Toggle */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {granularities.map((item) => (
              <button
                key={item.value}
                type="button"
                disabled={!activeBatchId}
                onClick={() => setGranularity(item.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 ${
                  granularity === item.value
                    ? 'bg-white text-indigo-600 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
};