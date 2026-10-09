export function discoveryReasonLabel(reason: string) {
  switch (reason) {
    case 'direct-feed':
      return '直接命中 feed';
    case 'html-alternate':
      return '站点 alternate feed';
    case 'rsshub-route':
      return 'RSSHub 路由';
    case 'existing-source-match':
      return '已有关联源';
    case 'url-probe':
      return '常见 feed 路径探测';
    default:
      return reason;
  }
}
