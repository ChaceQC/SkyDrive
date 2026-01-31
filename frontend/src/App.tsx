import { Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SharePage from './pages/Share';
import PrivateRoute from './components/PrivateRoute';
import zhCN from 'antd/locale/zh_CN';

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/share/:shareKey" element={<SharePage />} />
        <Route 
          path="/*" 
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } 
        />
      </Routes>
    </ConfigProvider>
  );
}

export default App;