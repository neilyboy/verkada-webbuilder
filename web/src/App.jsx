import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Viewer from './pages/Viewer.jsx';
import AdminApp from './pages/AdminApp.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/v/:slug" element={<Viewer />} />
      <Route path="/*" element={<AdminApp />} />
    </Routes>
  );
}
