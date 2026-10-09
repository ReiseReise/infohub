import { MarkdownContent } from '../../components/MarkdownContent';

export function DailyFinishedReportArticle({
  markdown,
  draft = false,
}: {
  markdown: string;
  draft?: boolean;
}) {
  return (
    <article className="min-w-0 bg-white px-5 py-6 sm:px-10 sm:py-8">
      <div className="mx-auto max-w-[800px]">
        {draft ? <div className="mb-6 text-xs text-amber-700">事实草稿 · 未发布</div> : null}
        <MarkdownContent
          content={markdown}
          variant="report"
          mode="markdown"
          className="daily-edition-prose pb-12"
          empty="当前日报没有正文，请返回工作台重新生成。"
        />
      </div>
    </article>
  );
}
