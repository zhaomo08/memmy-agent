import { formatUserDateTime, formatUserListTime } from "../../lib/user-time-zone.js";
import { useTranslation } from "../../i18n/use-translation.js";

/** Short list timestamp; the full time and what it means live in the tooltip. */
export function MemoryListTime(props: { value?: string; label: string }) {
  const { language, t } = useTranslation();
  if (!props.value) return null;

  return (
    <time dateTime={props.value} title={`${props.label} ${formatUserDateTime(props.value)}`}>
      {formatUserListTime(props.value, language, { today: t("common.today"), yesterday: t("common.yesterday") })}
    </time>
  );
}

/** Up to four tags, minus the one that only repeats which page this is. */
export function MemoryCardTags(props: { tags: string[]; omit?: string }) {
  return (
    <>
      {props.tags.filter((tag) => tag !== props.omit).slice(0, 4).map((tag) => (
        <span key={tag} className="memory-card__tag">{tag}</span>
      ))}
    </>
  );
}
