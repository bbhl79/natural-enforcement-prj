import { Provider } from 'react-redux';

import LoginPage from './login/LoginPage';
import { store } from './store';

export default function App() {
  return (
    <Provider store={store}>
      <LoginPage />
    </Provider>
  );
}
