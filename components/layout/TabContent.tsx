"use client";

import { useTabStore } from "@/stores/tab-store";
import { PartnersList } from "@/components/modules/partners/PartnersList";
import { PartnerForm } from "@/components/modules/partners/PartnerForm";
import { ProjectsList } from "@/components/modules/projects/ProjectsList";
import { ProjectForm } from "@/components/modules/projects/ProjectForm";
import { QuotesList } from "@/components/modules/quotes/QuotesList";
import { QuoteForm } from "@/components/modules/quotes/QuoteForm";
import { BudgetsList } from "@/components/modules/budgets/BudgetsList";
import { BudgetForm } from "@/components/modules/budgets/BudgetForm";
import { BudgetDetail } from "@/components/modules/budgets/BudgetDetail";
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
import { FolderKanban } from "lucide-react";

export function TabContent() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
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

  const key = activeTab.moduleKey;
  const params = activeTab.params ?? {};

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
          tabId={activeTab.id}
          readOnly={activeTab.tabType === "view"}
        />
      );
    case "projects":
      return <ProjectsList />;
    case "projects-form":
      return (
        <ProjectForm
          projectId={resolveId("projectId")}
          tabId={activeTab.id}
          readOnly={activeTab.tabType === "view"}
        />
      );
    case "quotes":
      return <QuotesList />;
    case "quotes-form":
      return (
        <QuoteForm
          quoteId={resolveId("quoteId")}
          tabId={activeTab.id}
          readOnly={activeTab.tabType === "view"}
        />
      );
    case "budgets":
      return <BudgetsList />;
    case "budgets-detail":
      return (
        <BudgetDetail
          budgetId={resolveId("budgetId") as number}
          tabId={activeTab.id}
        />
      );
    case "budgets-form":
      return (
        <BudgetForm
          budgetId={resolveId("budgetId")}
          tabId={activeTab.id}
          readOnly={activeTab.tabType === "view"}
        />
      );
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
          tabId={activeTab.id}
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
          tabId={activeTab.id}
        />
      );
    case "scenarios-preview":
      return (
        <ScenarioPreview
          scenarioId={resolveId("scenarioId") as number}
          tabId={activeTab.id}
        />
      );
    case "ai-assistant":
      return <AiAssistant />;
    case "items":
      return <ItemSearch />;
    default:
      return (
        <div className="flex-1 flex items-center justify-center bg-white">
          <p className="text-sm text-[var(--slate-400)]">
            Modul: <strong>{key}</strong> — hamarosan elérhető
          </p>
        </div>
      );
  }
}
