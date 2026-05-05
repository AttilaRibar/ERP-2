"use client";

import { AlertTriangle } from "lucide-react";
import type { VersionImportIssue, VersionImportIssues } from "@/types/import-issues";

interface ImportIssuesIndicatorProps {
  issues: VersionImportIssues | null;
  compact?: boolean;
}

function countIssues(issues: VersionImportIssues | null): number {
  if (!issues) return 0;
  return issues.readErrors.length + issues.formulaErrors.length + issues.contentErrors.length;
}

function IssueGroup({ title, items }: { title: string; items: VersionImportIssue[] }) {
  if (items.length === 0) return null;

  return (
    <div className="border-t border-slate-200 first:border-t-0 py-1.5 first:pt-0 last:pb-0">
      <div className="text-[10px] font-semibold text-amber-700 mb-1">
        {title} ({items.length})
      </div>
      <div className="space-y-1">
        {items.slice(0, 5).map((issue, index) => {
          const location = [issue.fileName, issue.sheet, issue.row ? `sor ${issue.row}` : null]
            .filter(Boolean)
            .join(" · ");
          const priceRows = issue.priceRows ?? [];

          if (priceRows.length > 0) {
            return (
              <div key={index} className="rounded-[6px] border border-slate-200 bg-slate-50 p-2 text-[10px] leading-snug text-slate-700">
                <div className="font-semibold text-slate-900">{issue.message}</div>
                {issue.description && <div className="mt-0.5 text-slate-600">{issue.description}</div>}
                {issue.totalDifference && (
                  <div className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                    Szumma plusz: {issue.totalDifference}
                  </div>
                )}
                <div className="mt-1.5 max-h-28 overflow-y-auto">
                  <table className="w-full text-[9px]">
                    <thead className="text-amber-700">
                      <tr>
                        <th className="py-0.5 pr-1 text-left font-medium">Kategória</th>
                        <th className="py-0.5 px-1 text-right font-medium">Menny.</th>
                        <th className="py-0.5 px-1 text-right font-medium">A e.ár</th>
                        <th className="py-0.5 px-1 text-right font-medium">D e.ár</th>
                        <th className="py-0.5 pl-1 text-right font-medium">Plusz</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceRows.slice(0, 6).map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-slate-200">
                          <td className="py-0.5 pr-1 align-top">
                            <div className="max-w-[180px] truncate text-slate-800" title={row.categoryPath}>{row.categoryPath}</div>
                            <div className="truncate text-slate-500" title={row.fileName}>{row.fileName}</div>
                          </td>
                          <td className="py-0.5 px-1 text-right align-top tabular-nums">{row.quantity}</td>
                          <td className="py-0.5 px-1 text-right align-top tabular-nums">{row.materialUnitPrice}</td>
                          <td className="py-0.5 px-1 text-right align-top tabular-nums">{row.feeUnitPrice}</td>
                          <td className="py-0.5 pl-1 text-right align-top tabular-nums text-amber-700 font-semibold">{row.difference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {priceRows.length > 6 && (
                    <div className="mt-1 text-slate-500">+{priceRows.length - 6} további előfordulás</div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={index} className="text-[10px] leading-snug text-slate-700">
              {location && <div className="font-mono text-amber-700">[{location}]</div>}
              <div>{issue.message}</div>
              {issue.details?.slice(0, 3).map((detail, detailIndex) => (
                <div key={detailIndex} className="text-slate-600">{detail}</div>
              ))}
            </div>
          );
        })}
        {items.length > 5 && (
          <div className="text-[10px] text-slate-500">+{items.length - 5} további hiba</div>
        )}
      </div>
    </div>
  );
}

export function ImportIssuesIndicator({ issues, compact = false }: ImportIssuesIndicatorProps) {
  const total = countIssues(issues);
  if (!issues || total === 0) return null;

  return (
    <span className="group/import-issues relative inline-flex flex-shrink-0" onClick={(event) => event.stopPropagation()}>
      <AlertTriangle
        size={compact ? 12 : 14}
        className="text-amber-500"
        aria-label={`${total} import ellenőrzési hiba`}
      />
      <div className="absolute left-1/2 top-full z-50 mt-1.5 hidden w-[520px] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left shadow-lg group-hover/import-issues:block pointer-events-none">
        <div className="mb-1.5 text-[10px] font-semibold text-amber-700">
          Import ellenőrzési hibák ({total})
        </div>
        <IssueGroup title="Excel beolvasási hibák" items={issues.readErrors} />
        <IssueGroup title="Képlet hibák" items={issues.formulaErrors} />
        <IssueGroup title="Tartalmi hibák" items={issues.contentErrors} />
      </div>
    </span>
  );
}
