"use client";

import { memo } from "react";
import { useTabStore, type ErpTab } from "@/stores/tab-store";
import { PartnersList } from "@/components/modules/partners/PartnersList";
import { PartnerForm } from "@/components/modules/partners/PartnerForm";
import { ProjectsList } from "@/components/modules/projects/ProjectsList";
import { ProjectForm } from "@/components/modules/projects/ProjectForm";
import { QuotesList } from "@/components/modules/quotes/QuotesList";
import { QuoteForm } from "@/components/modules/quotes/QuoteForm";
import { BudgetsList } from "@/components/modules/budgets/BudgetsList";
import { BudgetForm } from "@/components/modules/budgets/BudgetForm";
import { BudgetDetail } from "@/components/modules/budgets/BudgetDetail";
import { BudgetItemsPanel } from "@/components/modules/budgets/BudgetItemsPanel";
import { MultiVersionComparison } from "@/components/modules/budgets/MultiVersionComparison";
import { VersionComparison } from "@/components/modules/budgets/VersionComparison";
import { type CompareType, type SimpleCompareState, type MultiCompareState } from "@/server/actions/comparisons";
import { type VersionType } from "@/server/actions/versions";
import { AiAssistant } from "@/components/modules/ai-assistant/AiAssistant";
import { ReportsDashboard } from "@/components/modules/reports/ReportsDashboard";
import { ScenariosList } from "@/components/modules/scenarios/ScenariosList";
import { ScenarioEditor } from "@/components/modules/scenarios/ScenarioEditor";
import { ScenarioPreview } from "@/components/modules/scenarios/ScenarioPreview";
import { SettlementsList } from "@/components/modules/settlements/SettlementsList";
import { SettlementSetup } from "@/components/modules/settlements/SettlementSetup";
import { SettlementManager } from "@/components/modules/settlements/SettlementManager";
import { SettlementReview } from "@/components/modules/settlements/SettlementReview";
import { ItemSearch } from "@/components/modules/items/ItemSearch";
import { PricingWorkspace } from "@/components/modules/pricing/PricingWorkspace";
import { FolderKanban } from "lucide-react";

/**
 * Renders the content for a single tab. Memoized so that switching the active
 * tab does not re-render the inactive ones — and combined with the parent
 * keeping every panel mounted, this preserves all in-progress local state
 * (form inputs, scroll position, filters, etc.) across tab switches.
 */
const TabPanel = memo(function TabPanel({ tab }: { tab: ErpTab }) {
  const key = tab.moduleKey;
  const params = tab.params ?? {};

  // Unified ID resolution: support both entity-specific params (e.g. projectId)
  // and generic params.id — the latter is used by AI linked content cards
  const resolveId = (specificKey: string): number | undefined => {
    const v = params[specificKey] ?? params.id;
    return v != null ? Number(v) : undefined;
  };

  switch (key) {
    case "partners":
      return <PartnersList />;
    case "partners-form":
      return (
        <PartnerForm
          partnerId={resolveId("partnerId")}
          tabId={tab.id}
          readOnly={tab.tabType === "view"}
        />
      );
    case "projects":
      return <ProjectsList />;
    case "projects-form":
      return (
        <ProjectForm
          projectId={resolveId("projectId")}
          tabId={tab.id}
          readOnly={tab.tabType === "view"}
        />
      );
    case "quotes":
      return <QuotesList />;
    case "quotes-form":
      return (
        <QuoteForm
          quoteId={resolveId("quoteId")}
          tabId={tab.id}
          readOnly={tab.tabType === "view"}
        />
      );
    case "budgets":
      return <BudgetsList />;
    case "budgets-detail":
      return (
        <BudgetDetail
          budgetId={resolveId("budgetId") as number}
          tabId={tab.id}
          initialVersionId={params.initialVersionId != null ? Number(params.initialVersionId) : undefined}
          initialVersionName={params.initialVersionName as string | undefined}
          initialVersionType={params.initialVersionType as VersionType | undefined}
          initialPartnerName={(params.initialPartnerName as string | null | undefined) ?? null}
        />
      );
    case "budgets-form":
      return (
        <BudgetForm
          budgetId={resolveId("budgetId")}
          tabId={tab.id}
          readOnly={tab.tabType === "view"}
        />
      );
    case "budgets-version": {
      const budgetId = resolveId("budgetId") as number;
      const versionId = resolveId("versionId") as number;
      const openVersionTab = (
        nextVersionId: number,
        versionName: string,
        versionType: VersionType,
        partnerName: string | null,
      ) => {
        const { openTab } = useTabStore.getState();
        openTab({
          moduleKey: "budgets-version",
          title: versionName,
          color: "#f59e0b",
          tabType: "view",
          subtitle: tab.subtitle,
          params: {
            budgetId,
            versionId: nextVersionId,
            versionName,
            versionType,
            partnerName,
          },
        });
      };

      return (
        <BudgetItemsPanel
          versionId={versionId}
          versionName={(params.versionName as string | undefined) ?? `Verzió #${versionId}`}
          versionType={(params.versionType as VersionType | undefined) ?? "offer"}
          partnerName={(params.partnerName as string | null | undefined) ?? null}
          budgetId={budgetId}
          onBack={() => useTabStore.getState().closeTab(tab.id)}
          onVersionCreated={openVersionTab}
        />
      );
    }
    case "budgets-comparison": {
      const vIds = params.versionIds as number[];
      const vNames = params.versionNames as string[];
      const bId = resolveId("budgetId") as number;
      const cType = (params.compareType as CompareType) ?? "multi";
      const savedState = params.state as SimpleCompareState | MultiCompareState | undefined;
      const onTabBack = () => {
        const { closeTab } = useTabStore.getState();
        closeTab(tab.id);
      };
      if (cType === "simple" && vIds.length === 2) {
        return (
          <VersionComparison
            versionAId={vIds[0]}
            versionBId={vIds[1]}
            nameA={vNames[0]}
            nameB={vNames[1]}
            budgetId={bId}
            initialState={savedState as SimpleCompareState | undefined}
            onBack={onTabBack}
          />
        );
      }
      return (
        <MultiVersionComparison
          versionIds={vIds}
          versionNames={vNames}
          budgetId={bId}
          initialState={savedState as MultiCompareState | undefined}
          onBack={onTabBack}
        />
      );
    }
    case "reports":
      return <ReportsDashboard />;
    case "settlements":
      return <SettlementsList />;
    case "settlements-setup":
      return <SettlementSetup />;
    case "settlements-manage":
      return (
        <SettlementManager
          contractId={resolveId("contractId") as number}
          tabId={tab.id}
        />
      );
    case "settlements-review":
      return (
        <SettlementReview
          contractId={resolveId("contractId") as number}
          invoiceId={resolveId("invoiceId") as number}
        />
      );
    case "scenarios":
      return <ScenariosList />;
    case "scenarios-editor":
      return (
        <ScenarioEditor
          scenarioId={resolveId("scenarioId")}
          tabId={tab.id}
        />
      );
    case "scenarios-preview":
      return (
        <ScenarioPreview
          scenarioId={resolveId("scenarioId") as number}
          tabId={tab.id}
        />
      );
    case "ai-assistant":
      return <AiAssistant />;
    case "items":
      return <ItemSearch />;
    case "pricing":
      return <PricingWorkspace />;
    default:
      return (
        <div className="flex-1 flex items-center justify-center bg-white">
          <p className="text-sm text-[var(--slate-400)]">
            Modul: <strong>{key}</strong> — hamarosan elérhető
          </p>
        </div>
      );
  }
});

export function TabContent() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <FolderKanban className="mx-auto mb-3 text-[var(--slate-300)]" size={40} />
          <p className="text-sm text-[var(--slate-400)]">
            Válasszon egy modult a menüből vagy nyisson új lapot
          </p>
        </div>
      </div>
    );
  }

  // Render every open tab simultaneously and hide inactive ones via CSS.
  // This keeps each panel mounted, preserving its state across tab switches
  // (form inputs, scroll position, in-flight edits, etc.).
  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={isActive ? "flex-1 flex min-w-0 overflow-hidden" : "hidden"}
            aria-hidden={!isActive}
          >
            <TabPanel tab={tab} />
          </div>
        );
      })}
    </>
  );
}
