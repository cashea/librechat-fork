import { Navigate, useParams } from 'react-router-dom';
import DashboardRoute from './Layouts/Dashboard';

function PromptsRedirect() {
  const { '*': splat } = useParams();
  const target = splat ? `/prompts/${splat}` : '/prompts/new';
  return <Navigate to={target} replace={true} />;
}

const loadGatewayDashboard = () =>
  import('~/components/Gateway/GatewayDashboard').then((m) => ({
    Component: m.default,
  }));

const dashboardRoutes = {
  path: 'd/*',
  element: <DashboardRoute />,
  children: [
    {
      path: 'prompts/*',
      element: <PromptsRedirect />,
    },
    {
      path: 'gateway',
      lazy: loadGatewayDashboard,
    },
    {
      path: '*',
      element: <Navigate to="/c/new" replace={true} />,
    },
  ],
};

export default dashboardRoutes;
