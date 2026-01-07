import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar/Navbar';
import Home from './pages/Home';
import Galleries from './pages/Galleries';
import Gallery from './pages/Gallery';
import './styles/globals.css';

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/galleries" element={<Galleries />} />
          <Route path="/g/:slug" element={<Gallery />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
