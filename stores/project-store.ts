import { create } from "zustand";

export interface ProjectOption {
  id: number;
  projectCode: string | null;
  name: string;
}

interface ProjectStore {
  /** Currently selected project, null means "no project selected" */
  selectedProject: ProjectOption | null;
  /** Available projects for the selector */
  projects: ProjectOption[];
  /** Whether the project list has been loaded */
  loaded: boolean;
  setSelectedProject: (project: ProjectOption | null) => void;
  setProjects: (projects: ProjectOption[]) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  selectedProject: null,
  projects: [],
  loaded: false,
  setSelectedProject: (project) => set({ selectedProject: project }),
  setProjects: (projects) => set({ projects, loaded: true }),
}));
