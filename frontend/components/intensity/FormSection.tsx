import type { ReactNode } from "react";

/** Секция шага: заголовок, короткий лид, поля и необязательное «Как это работает». */
export function FormSection({
  title,
  aside,
  lead,
  details,
  mark,
  children,
}: {
  title: string;
  aside?: ReactNode;
  lead?: ReactNode;
  details?: ReactNode[];
  mark?: string;
  children?: ReactNode;
}) {
  return (
    <section className="form-section" data-health={mark}>
      <div className="form-section-head">
        <h3>{title}</h3>
        {aside && <div className="form-section-aside">{aside}</div>}
      </div>
      {lead && <p className="form-section-lead">{lead}</p>}
      {children && <div className="form-section-body">{children}</div>}
      {details && details.length > 0 && (
        <details className="form-details">
          <summary>Как это работает</summary>
          <ul>
            {details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
