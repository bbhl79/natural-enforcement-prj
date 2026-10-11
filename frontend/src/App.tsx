import { useEffect } from 'react';
import { Provider } from 'react-redux';

import HealthPanel from './health/HealthPanel';
import { fetchHealthSnapshot } from './health/healthSlice';
import { useAppDispatch } from './hooks';
import { store } from './store';

function PanelWithData() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(fetchHealthSnapshot());
  }, [dispatch]);

  return <HealthPanel />;
}

export default function App() {
  return (
    <Provider store={store}>
      <PanelWithData />
    </Provider>
  );
}
