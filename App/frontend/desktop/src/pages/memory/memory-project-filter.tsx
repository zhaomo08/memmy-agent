import { useMemo } from "react";
import { FolderGit2, Folders } from "lucide-react";
import type { PanelProject } from "@memmy/local-api-contracts";
import { Select } from "../../components/Select.js";

export interface MemoryProjectFilterProps {
  id: string;
  value: string;
  projects: PanelProject[];
  onValueChange: (value: string) => void;
  label: string;
  allLabel: string;
}

/**
 * Scopes the memories list to one project.
 *
 * Recall stays global on purpose -- Memmy remembers the person across projects and tools --
 * so this is a browsing filter only, never applied to what an agent recalls.
 */
export function MemoryProjectFilter(props: MemoryProjectFilterProps) {
  const options = useMemo(() => [
    {
      value: "",
      label: props.allLabel,
      icon: <Folders size={15} strokeWidth={2} className="memory-source-filter__icon" />
    },
    ...props.projects.map((project) => ({
      value: project.projectId,
      label: `${project.label} (${project.memoryCount})`,
      icon: <FolderGit2 size={15} strokeWidth={2} className="memory-source-filter__icon" />
    }))
  ], [props.allLabel, props.projects]);

  return (
    <Select
      id={props.id}
      label={props.label}
      labelClassName="sr-only"
      value={props.value}
      onValueChange={props.onValueChange}
      options={options}
      className="memory-source-filter"
      buttonClassName="memory-source-filter__button"
      menuClassName="memory-source-filter__menu"
    />
  );
}
