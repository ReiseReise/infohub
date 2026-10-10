import { useState } from 'react';
import { useSettings } from '../SettingsContext';
import { INTEGRATIONS_KEY, readLocal, sectionTitle, writeLocal, type IntegrationPrefs } from '../shared';

export function IntegrationsTab() {
  const { setNotice } = useSettings();
  const [integrationPrefs, setIntegrationPrefs] = useState<IntegrationPrefs>(() => readLocal<IntegrationPrefs>(INTEGRATIONS_KEY, {
    ntfyTopic: '',
    feishuWebhook: '',
    webhookSecret: '',
  }));

  const saveIntegrationPrefs = () => {
    writeLocal(INTEGRATIONS_KEY, integrationPrefs);
    setNotice('集成配置已保存（本地）');
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      {sectionTitle('集成配置', '当前版本先保存到本地浏览器，后续可迁移到服务端')}
      <input
        value={integrationPrefs.ntfyTopic}
        onChange={(e) => setIntegrationPrefs((prev) => ({ ...prev, ntfyTopic: e.target.value }))}
        placeholder="ntfy topic"
        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
      />
      <input
        value={integrationPrefs.feishuWebhook}
        onChange={(e) => setIntegrationPrefs((prev) => ({ ...prev, feishuWebhook: e.target.value }))}
        placeholder="飞书 Webhook"
        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
      />
      <input
        value={integrationPrefs.webhookSecret}
        onChange={(e) => setIntegrationPrefs((prev) => ({ ...prev, webhookSecret: e.target.value }))}
        placeholder="回调签名密钥"
        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
      />
      <button onClick={saveIntegrationPrefs} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">
        保存集成配置
      </button>
    </div>
  );
}
