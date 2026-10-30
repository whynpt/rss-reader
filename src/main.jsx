import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { PlaybackProvider } from './components/PlaybackProvider.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PlaybackProvider><App /></PlaybackProvider>
  </React.StrictMode>
);
