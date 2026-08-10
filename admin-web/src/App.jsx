import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthed } from './api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import Products from './pages/Products.jsx';
import Stock from './pages/Stock.jsx';
import Users from './pages/Users.jsx';
import Vouchers from './pages/Vouchers.jsx';
import Broadcast from './pages/Broadcast.jsx';
import Settings from './pages/Settings.jsx';
import PaymentGateway from './pages/PaymentGateway.jsx';
import BotSettings from './pages/BotSettings.jsx';
import Transactions from './pages/Transactions.jsx';
import Balance from './pages/Balance.jsx';
import FlashSale from './pages/FlashSale.jsx';
import Logs from './pages/Logs.jsx';

function Protected({ children }) {
  return isAuthed() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="products" element={<Products />} />
        <Route path="stock" element={<Stock />} />
        <Route path="users" element={<Users />} />
        <Route path="vouchers" element={<Vouchers />} />
        <Route path="flash-sale" element={<FlashSale />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="balance" element={<Balance />} />
        <Route path="payment-gateway" element={<PaymentGateway />} />
        <Route path="bot-settings" element={<BotSettings />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
