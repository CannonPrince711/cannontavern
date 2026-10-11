import { BookOpen, Dices, Sparkles } from 'lucide-react'
import { LanternArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { StepHeader, type StepProps } from './Wizard'

const POINTS = [
  { icon: BookOpen, title: 'Your vault, your notes', text: 'Characters, campaigns and every session are plain Markdown in Obsidian.' },
  { icon: Sparkles, title: 'Any model, anywhere', text: 'Local, on a rented GPU, over Tailscale or in the cloud, text and images.' },
  { icon: Dices, title: 'Real dice, real sheets', text: 'Checks, saves, combat and a character sheet that updates itself.' }
]

export function WelcomeStep({ next }: StepProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-4 w-28">
        <LanternArt />
      </div>
      <StepHeader title="Welcome to the Tavern">
        Pull up a chair. A few quick steps and your first adventure will be waiting.
      </StepHeader>
      <ul className="mb-8 grid w-full gap-3 sm:grid-cols-3">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="paper rounded-xl border bg-card p-4 shadow-card">
            <Icon className="mb-2 size-5 text-gold" aria-hidden />
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>
      <Button size="lg" onClick={next} autoFocus>
        Begin
      </Button>
    </div>
  )
}
