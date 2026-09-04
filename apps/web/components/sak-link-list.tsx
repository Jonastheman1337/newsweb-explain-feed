import {
  buildSakLinkList,
  type SakArticle,
  type SakHrefResolver
} from "@newsweb/shared";

type SakLinkListProps = {
  article: SakArticle;
  resolveHref: SakHrefResolver;
};

export function SakLinkList({ article, resolveHref }: SakLinkListProps) {
  const links = buildSakLinkList(article, resolveHref);
  if (!links.length) return null;

  return (
    <table className="sakLinkTable">
      <tbody>
        {links.map((link) => (
          <tr key={link.url}>
            <td>{link.text}</td>
            <td>
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.url}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
