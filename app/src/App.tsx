import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { Boot } from './components/Boot'
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
import TorrentPlayer from './pages/TorrentPlayer'
import MangaHome from './manga/MangaHome'
import MangaTitle from './manga/MangaTitle'
import MangaReader from './manga/Reader'
import Ranobe from './manga/Ranobe'
import BookReader from './manga/BookReader'
import RanobeHome from './ranobe/RanobeHome'
import NovelPage from './ranobe/NovelPage'
import NovelReader from './ranobe/NovelReader'
import About from './pages/About'
import Status from './pages/Status'
import ProfilePage from './pages/Profile'
import Moderation from './pages/Moderation'
import Top from './pages/Top'
import Achievements from './pages/Achievements'
import Roulette from './pages/Roulette'
import AiSearch from './pages/AiSearch'
import Join from './pages/Join'

// HashRouter: works from file:// in Electron and capacitor:// on iPad
export default function App() {
  return (
    <HashRouter>
      <Boot>
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
            <Route path="/top" element={<Top />} />
            <Route path="/roulette" element={<Roulette />} />
            <Route path="/ai" element={<AiSearch />} />
            <Route path="/join/:code" element={<Join />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/achievements/:username" element={<Achievements />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/torrent" element={<TorrentPlayer />} />
            <Route path="/manga" element={<MangaHome />} />
            <Route path="/manga/:id" element={<MangaTitle />} />
            <Route path="/manga/read/:id/:chapterId" element={<MangaReader />} />
            <Route path="/ranobe" element={<RanobeHome />} />
            <Route path="/ranobe/files" element={<Ranobe />} />
            <Route path="/ranobe/n/:src/:id" element={<NovelPage />} />
            <Route path="/ranobe/n/:src/:id/:ch" element={<NovelReader />} />
            <Route path="/ranobe/:id" element={<BookReader />} />
            <Route path="/about" element={<About />} />
            <Route path="/about/:page" element={<About />} />
            <Route path="/status" element={<Status />} />
            <Route path="/u/:username" element={<ProfilePage />} />
            <Route path="/moderation" element={<Moderation />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Layout>
      </Boot>
    </HashRouter>
  )
}
