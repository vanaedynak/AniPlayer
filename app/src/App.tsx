import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Catalog from './pages/Catalog'
import Search from './pages/Search'
import Schedule from './pages/Schedule'
import Title from './pages/Title'
import Watch from './pages/Watch'
import Anime from './pages/Anime'
import History from './pages/History'
import Collection from './pages/Collection'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Downloads from './pages/Downloads'
import MangaHome from './manga/MangaHome'
import MangaTitle from './manga/MangaTitle'
import MangaReader from './manga/Reader'
import Ranobe from './manga/Ranobe'
import BookReader from './manga/BookReader'

// HashRouter: works from file:// in Electron and capacitor:// on iPad
export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/search" element={<Search />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/title/:alias" element={<Title />} />
          <Route path="/watch/:alias/:ordinal" element={<Watch />} />
          <Route path="/anime/:id" element={<Anime />} />
          <Route path="/history" element={<History />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/manga" element={<MangaHome />} />
          <Route path="/manga/:id" element={<MangaTitle />} />
          <Route path="/manga/read/:id/:chapterId" element={<MangaReader />} />
          <Route path="/ranobe" element={<Ranobe />} />
          <Route path="/ranobe/:id" element={<BookReader />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Layout>
    </HashRouter>
  )
}
