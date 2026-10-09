/**
 * 跳过导航链接：Tab 时可见，点击后跳到主内容区域。
 * 满足 WCAG 2.4.1 (Bypass Blocks)。
 */
export function SkipNavLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-teal-700 focus:shadow-lg focus:ring-2 focus:ring-teal-500"
    >
      跳转到主内容
    </a>
  );
}
