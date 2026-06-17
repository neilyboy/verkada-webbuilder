import React, { useState } from 'react';
import { api } from '../api.js';
import { Lock, Loader2 } from 'lucide-react';

export default function Login({ status, onAuthed }) {
  const isSetup = !status.adminConfigured;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (isSetup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (isSetup) await api.post('/api/admin/setup', { password });
      else await api.post('/api/admin/login', { password });
      onAuthed();
    } catch (err) {
      setError(err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Lock className="h-5 w-5 text-blue-400" />
          {isSetup ? 'Create admin password' : 'Admin sign in'}
        </div>
        {isSetup && (
          <p className="mb-4 text-sm text-gray-400">
            First run: choose a password to protect this admin console.
          </p>
        )}
        <label className="label">Password</label>
        <input
          type="password"
          className="input mb-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {isSetup && (
          <>
            <label className="label">Confirm password</label>
            <input
              type="password"
              className="input mb-3"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </>
        )}
        {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSetup ? 'Create & continue' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
