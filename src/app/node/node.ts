import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject } from '@angular/core';

type Heading = 'up' | 'right' | 'down' | 'left';
type Turn = 'STRAIGHT' | 'LEFT' | 'RIGHT' | 'UTURN';

interface PathInstruction {
  from: number;
  to: number;
  turn: Turn;
  heading: Heading;
}

interface PathResult {
  startNode: number;
  destinationNode: number;
  path: number[];
  instructions: PathInstruction[];
  heading: Heading;
}

@Component({
  selector: 'app-node',
  standalone: true,
  templateUrl: './node.html',
  styleUrl: './node.css',
})
export class Node {
  readonly nodes = Array.from({ length: 12 }, (_, index) => index + 1);
  readonly pathEndpoint = '/api/robot/path';

  startNode: number | null = null;
  destinationNode: number | null = null;
  path: number[] | null = null;
  instructions: PathInstruction[] = [];
  isCalculating = false;
  statusMessage = 'Sélectionnez le nœud de départ sur la carte.';
  errorMessage: string | null = null;

  private readonly http = inject(HttpClient);
  private readonly changeDetector = inject(ChangeDetectorRef);

  selectNode(node: number): void {
    if (this.isCalculating) {
      return;
    }

    this.errorMessage = null;

    if (this.startNode === null) {
      this.startNode = node;
      this.statusMessage = `Départ sélectionné : nœud ${node}. Choisissez une destination.`;
      return;
    }

    if (node === this.startNode) {
      this.destinationNode = null;
      this.path = null;
      this.instructions = [];
      this.statusMessage = `Départ sélectionné : nœud ${node}. Choisissez une destination.`;
      return;
    }

    this.destinationNode = node;
    this.calculatePath();
  }

  retryPathCalculation(): void {
    if (this.startNode !== null && this.destinationNode !== null && !this.isCalculating) {
      this.calculatePath();
    }
  }

  resetRoute(): void {
    if (this.isCalculating) {
      return;
    }

    this.startNode = null;
    this.destinationNode = null;
    this.path = null;
    this.instructions = [];
    this.errorMessage = null;
    this.statusMessage = 'Sélectionnez le nœud de départ sur la carte.';
  }

  isNodeOnPath(node: number): boolean {
    return this.path?.includes(node) ?? false;
  }

  turnLabel(turn: Turn): string {
    const labels: Record<Turn, string> = {
      STRAIGHT: 'Continuer tout droit',
      LEFT: 'Tourner à gauche',
      RIGHT: 'Tourner à droite',
      UTURN: 'Faire demi-tour',
    };

    return labels[turn];
  }

  headingLabel(heading: Heading): string {
    const labels: Record<Heading, string> = {
      up: 'Est',
      right: 'Sud',
      down: 'Ouest',
      left: 'Nord',
    };

    return labels[heading];
  }

  private calculatePath(): void {
    const startNode = this.startNode;
    const destinationNode = this.destinationNode;

    if (startNode === null || destinationNode === null) {
      return;
    }

    this.path = null;
    this.instructions = [];
    this.isCalculating = true;
    this.statusMessage = `Calcul du chemin optimal de ${startNode} à ${destinationNode}…`;

    this.http.post<PathResult>(this.pathEndpoint, { startNode, destinationNode }).subscribe({
      next: (result) => {
        this.path = result.path;
        this.instructions = result.instructions;
        this.isCalculating = false;
        this.statusMessage = `Chemin calculé : ${result.path.length - 1} segment(s). Le robot n’a pas été sollicité.`;
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        const reason = error.status === 0 ? 'Backend injoignable' : `Erreur HTTP ${error.status}`;

        this.isCalculating = false;
        this.errorMessage = `${reason}. Vérifiez que le backend est lancé, puis réessayez le calcul.`;
        this.statusMessage = 'Le calcul du chemin a échoué.';
        this.changeDetector.markForCheck();
      },
    });
  }
}
