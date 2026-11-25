import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Node } from './node';

describe('Node', () => {
  let component: Node;
  let fixture: ComponentFixture<Node>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Node],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(Node);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('requests and displays a path without sending a robot movement command', async () => {
    fixture.nativeElement.querySelectorAll('.node')[0].click();
    fixture.detectChanges();
    fixture.nativeElement.querySelectorAll('.node')[11].click();
    fixture.detectChanges();

    const request = httpTestingController.expectOne('/api/robot/path');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ startNode: 1, destinationNode: 12 });
    expect(component.startNode).toBe(1);
    expect(component.destinationNode).toBe(12);
    expect(component.isCalculating).toBe(true);

    request.flush({
      startNode: 1,
      destinationNode: 12,
      path: [1, 2, 3, 4, 8, 12],
      instructions: [
        { from: 1, to: 2, turn: 'RIGHT', heading: 'right' },
        { from: 2, to: 3, turn: 'STRAIGHT', heading: 'right' },
      ],
      heading: 'right',
    });

    expect(component.startNode).toBe(1);
    expect(component.destinationNode).toBe(12);
    expect(component.path).toEqual([1, 2, 3, 4, 8, 12]);
    expect(component.instructions).toHaveLength(2);
    expect(component.isCalculating).toBe(false);
    expect(component.statusMessage).toContain('Le robot n’a pas été sollicité');

    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 → 2 → 3 → 4 → 8 → 12');
    expect(fixture.nativeElement.textContent).toContain('Tourner à droite');
    expect(fixture.nativeElement.textContent).toContain('direction Sud');
  });

  it('keeps the selected nodes and allows retry when path calculation fails', () => {
    fixture.nativeElement.querySelectorAll('.node')[3].click();
    fixture.detectChanges();
    fixture.nativeElement.querySelectorAll('.node')[7].click();
    fixture.detectChanges();

    const request = httpTestingController.expectOne('/api/robot/path');
    request.flush(null, { status: 500, statusText: 'Server Error' });

    expect(component.startNode).toBe(4);
    expect(component.destinationNode).toBe(8);
    expect(component.isCalculating).toBe(false);
    expect(component.errorMessage).toContain('500');

    component.retryPathCalculation();
    const retry = httpTestingController.expectOne('/api/robot/path');
    retry.flush({
      startNode: 4,
      destinationNode: 8,
      path: [4, 8],
      instructions: [{ from: 4, to: 8, turn: 'STRAIGHT', heading: 'down' }],
      heading: 'down',
    });
  });
});
