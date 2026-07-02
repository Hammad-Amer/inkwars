import { Link } from 'react-router-dom'
import './Home.css'

export default function Home() {
  return (
    <main className="home">
      <p className="home-kicker hand-note">round one: prove the robot can see</p>
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
        you. Multiplayer arrives in a later phase — right now, the AI guesser is in training.
      </p>
      <Link to="/model-test" className="home-cta">
        Open the model test lab →
      </Link>
    </main>
  )
}
