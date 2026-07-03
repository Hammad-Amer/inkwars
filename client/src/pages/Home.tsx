import { Link } from 'react-router-dom'
import './Home.css'

export default function Home() {
  return (
    <main className="home">
      <p className="home-kicker hand-note">the robot can see. now beat it.</p>
      <h1 className="home-title">
        Drawing
        <br />
        Arena
      </h1>
      <p className="home-vs">
        <span className="home-vs-humans">Humans</span>
        <span className="home-vs-mark">vs</span>
        <span className="home-vs-ai">AI</span>
      </p>
      <p className="home-blurb">
        A real-time drawing-and-guessing game where an AI watches the canvas and guesses alongside
        you. Draw the secret word — the faster the AI recognizes it, the more you score.
      </p>
      <div className="home-actions">
        <Link to="/rooms" className="home-cta home-cta-primary">
          Play with friends →
        </Link>
        <Link to="/play" className="home-cta">
          Solo practice
        </Link>
        <Link to="/model-test" className="home-cta">
          Model test lab
        </Link>
      </div>
    </main>
  )
}
