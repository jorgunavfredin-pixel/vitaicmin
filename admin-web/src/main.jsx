import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { BroadcastProvider } from './context/BroadcastContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin">
      <BroadcastProvider>
        <App />
      </BroadcastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
