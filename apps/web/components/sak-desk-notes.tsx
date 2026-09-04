import {
  sakMaterialSourceId,
  type SakArticle,
  type SakMaterial
} from "@newsweb/shared";

type SakDeskNotesProps = {
  article: SakArticle;
  materials: SakMaterial[];
};

/**
 * Source ledger, excluded PR quotes and desk notes. Rendered outside the
 * editable body so it is never part of the copied article.
 */
export function SakDeskNotes({ article, materials }: SakDeskNotesProps) {
  const materialsBySourceId = new Map(
    materials.map((material) => [sakMaterialSourceId(material.id), material] as const)
  );

  return (
    <details className="sakDeskNotes">
      <summary>Kilder og merknader</summary>

      {article.sources.length > 0 && (
        <>
          <p className="noticePanelTitle">Kilder</p>
          <ul>
            {article.sources.map((source, index) => {
              const material = materialsBySourceId.get(source.materialId);
              const label = material?.title ?? source.materialId;
              return (
                <li key={`${source.materialId}-${index}`}>
                  {material?.url ? (
                    <a href={material.url} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                  {" – "}
                  {source.usedFor}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {article.excluded_hype.length > 0 && (
        <>
          <p className="noticePanelTitle">Utelatt PR</p>
          <ul>
            {article.excluded_hype.map((entry, index) => (
              <li key={index}>
                {entry.speaker ? `${entry.speaker} · ` : ""}
                «{entry.quote}» · {entry.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="noticePanelTitle">Merknader</p>
      <ul>
        {article.desk_notes.length > 0 ? (
          article.desk_notes.map((note, index) => <li key={index}>{note}</li>)
        ) : (
          <li>Ingen merknader</li>
        )}
      </ul>
    </details>
  );
}
