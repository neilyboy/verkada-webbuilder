import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { KeyRound, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function Settings({ onChange }) {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [orgId, setOrgId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [msg, setMsg] = useState('');

  const load = () =>
    api.get('/api/admin/settings').then((s) => {
      setSettings(s);
      setOrgId(s.orgId || '');
      setBaseUrl(s.baseUrl || '');
    });
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const body = { orgId, baseUrl };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      await api.post('/api/admin/settings', body);
      setApiKey('');
      await load();
      onChange?.();
      setMsg('Saved.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTestResult({ loading: true });
    try {
      const r = await api.post('/api/admin/test');
      setTestResult({ ok: true, count: r.count });
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
    }
  };

  if (!settings) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Settings</h1>
      <p className="mb-6 text-sm text-gray-400">
        Your Verkada API key is encrypted at rest and never sent to viewers.
      </p>

      <div className="card mb-6">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4 text-blue-400" /> Verkada API
        </div>

        <label className="label">API Key {settings.hasApiKey && '(stored — leave blank to keep)'}</label>
        <input
          type="password"
          className="input mb-3"
          placeholder={settings.hasApiKey ? '•••••••••••••• (unchanged)' : 'Paste your Verkada API key'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <label className="label">Organization ID</label>
        <input
          className="input mb-3"
          placeholder="org_id (required for streaming)"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
        />

        <label className="label">API Base URL (region)</label>
        <input
          className="input mb-4"
          placeholder="https://api.verkada.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
          <button className="btn-ghost" onClick={test} disabled={!settings.hasApiKey}>
            Test connection
          </button>
          {testResult?.loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {testResult?.ok && (
            <span className="flex items-center gap-1 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" /> {testResult.count} cameras
            </span>
          )}
          {testResult && testResult.ok === false && (
            <span className="flex items-center gap-1 text-sm text-red-400">
              <XCircle className="h-4 w-4" /> {testResult.error}
            </span>
          )}
          {msg && <span className="text-sm text-gray-400">{msg}</span>}
        </div>
      </div>

      <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');

  const submit = async () => {
    setMsg('');
    try {
      await api.post('/api/admin/change-password', { current, next });
      setCurrent('');
      setNext('');
      setMsg('Password updated.');
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="card">
      <div className="mb-3 font-semibold">Change admin password</div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="password"
          className="input"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="password"
          className="input"
          placeholder="New password (min 8)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button className="btn-ghost shrink-0" onClick={submit}>
          Update
        </button>
      </div>
      {msg && <div className="mt-2 text-sm text-gray-400">{msg}</div>}
    </div>
  );
}
