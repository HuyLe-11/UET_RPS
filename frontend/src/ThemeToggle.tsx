import {useEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import './theme.css';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'ott-theme';

export default function ThemeToggle() {
  // The initializer runs once when this component is first mounted.
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  // Synchronize the React state with the document and browser storage.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'light' ? '#f5f4fa' : '#101018');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Switching still works if the browser blocks persistent storage.
    }
  }, [theme]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Chuyển sang giao diện ${nextTheme === 'light' ? 'sáng' : 'tối'}`;

  return <button
    type="button"
    className="theme-toggle"
    aria-label={label}
    title={label}
    onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
  >
    {theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}
    <span>{nextTheme === 'light' ? 'Sáng' : 'Tối'}</span>
  </button>;
}
