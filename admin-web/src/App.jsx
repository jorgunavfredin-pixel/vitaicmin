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
        <Route path="broadcast" element={<Broadcast />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
