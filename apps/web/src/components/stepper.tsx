import { Slot } from "@radix-ui/react-slot";
import {
  type ScopedProps,
  type Stepper as StepperizeContext,
  type Get as StepperizeGet,
  type Step as StepperizeStep,
  type StepperReturn,
  defineStepper as stepperizeDefineStepper,
} from "@stepperize/react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  Children,
  type ComponentProps,
  createContext,
  type ElementType,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/classname";

const StepperContext = createContext<StepperConfigProps | null>(null);

const useStepperProvider = (): StepperConfigProps => {
  const context = useContext(StepperContext);
  if (!context) {
    throw new Error("useStepper must be used within a StepperProvider.");
  }
  return context;
};

const defineStepper = <const Steps extends StepperizeStep[]>(
  ...steps: Steps
): StepperDefineProps<Steps> => {
  const { Scoped, useStepper, ...rest } = stepperizeDefineStepper(...steps);

  const StepperContainer = ({
    children,
    className,
    ...props
  }: Omit<ComponentProps<"div">, "children"> & {
    children:
      | ReactNode
      | ((props: { methods: StepperizeContext<Steps> }) => ReactNode);
  }) => {
    const methods = useStepper();

    return (
      <div
        className={cn("w-full", className)}
        data-component="stepper"
        {...props}
      >
        {typeof children === "function"
          ? children({ methods })
          : (children ?? null)}
      </div>
    );
  };

  const StepperProvider = ({
    variant = "horizontal",
    labelOrientation = "horizontal",
    tracking = false,
    children,
    className,
    initialStep,
    initialMetadata,
    ...providerRest
  }: Omit<ScopedProps<Steps>, "children"> &
    Omit<ComponentProps<"div">, "children"> &
    StepperConfigProps & {
      children:
        | ReactNode
        | ((props: { methods: StepperizeContext<Steps> }) => ReactNode);
    }) => {
    const contextValue = useMemo(
      () => ({ variant, labelOrientation, tracking }),
      [variant, labelOrientation, tracking]
    );

    return (
      <StepperContext.Provider value={contextValue}>
        <Scoped initialMetadata={initialMetadata} initialStep={initialStep}>
          <StepperContainer className={className} {...providerRest}>
            {children}
          </StepperContainer>
        </Scoped>
      </StepperContext.Provider>
    );
  };

  return {
    ...rest,
    useStepper,
    Stepper: {
      Provider: StepperProvider,
      Navigation: ({
        children,
        "aria-label": ariaLabel = "Stepper Navigation",
        ...props
      }) => {
        const { variant } = useStepperProvider();
        return (
          <nav
            aria-label={ariaLabel}
            data-component="stepper-navigation"
            {...props}
          >
            <ol
              className={classForNavigationList({ variant })}
              data-component="stepper-navigation-list"
            >
              {children}
            </ol>
          </nav>
        );
      },
      Step: ({ children, className, icon, ...props }) => {
        const { variant, labelOrientation } = useStepperProvider();
        const { current } = useStepper();

        const utils = rest.utils;
        const stepItems = rest.steps;

        const stepIndex = utils.getIndex(props.of);
        const step = stepItems[stepIndex];
        const currentIndex = utils.getIndex(current.id);

        const isLast = utils.getLast().id === props.of;
        const isActive = current.id === props.of;

        const dataState = getStepState(currentIndex, stepIndex);
        const isAccessible =
          dataState === "active" || dataState === "completed";
        const childMap = useStepChildren(children);

        const title = childMap.get("title");
        const description = childMap.get("description");
        const panel = childMap.get("panel");

        if (variant === "circle") {
          return (
            <li
              className={cn(
                "flex shrink-0 items-center gap-4 rounded-md transition-colors",
                className
              )}
              data-component="stepper-step"
            >
              <CircleStepIndicator
                currentStep={stepIndex + 1}
                totalSteps={stepItems.length}
              />
              <div
                className="flex flex-col items-start gap-1"
                data-component="stepper-step-content"
              >
                {title}
                {description}
              </div>
            </li>
          );
        }

        return (
          <>
            <li
              className={cn([
                "group peer relative flex items-center gap-2",
                "data-[variant=vertical]:flex-row",
                "data-[label-orientation=vertical]:w-full",
                "data-[label-orientation=vertical]:flex-col",
                "data-[label-orientation=vertical]:justify-center",
              ])}
              data-component="stepper-step"
              data-disabled={props.disabled}
              data-label-orientation={labelOrientation}
              data-state={dataState}
              data-variant={variant}
            >
              <Button
                aria-controls={`step-panel-${props.of}`}
                aria-current={isActive ? "step" : undefined}
                aria-posinset={stepIndex + 1}
                aria-selected={isActive}
                aria-setsize={stepItems.length}
                className="rounded-full"
                data-component="stepper-step-indicator"
                id={`step-${step.id}`}
                onKeyDown={(e) =>
                  onStepKeyDown(
                    e,
                    utils.getNext(props.of),
                    utils.getPrev(props.of)
                  )
                }
                role="tab"
                size="icon"
                tabIndex={isAccessible ? 0 : -1}
                type="button"
                variant={isAccessible ? "default" : "secondary"}
                {...props}
              >
                {icon ?? stepIndex + 1}
              </Button>
              {variant === "horizontal" && labelOrientation === "vertical" && (
                <StepperSeparator
                  disabled={props.disabled}
                  isLast={isLast}
                  labelOrientation={labelOrientation}
                  orientation="horizontal"
                  state={dataState}
                />
              )}
              <div
                className="flex flex-col items-start"
                data-component="stepper-step-content"
              >
                {title}
                {description}
              </div>
            </li>

            {variant === "horizontal" && labelOrientation === "horizontal" && (
              <StepperSeparator
                disabled={props.disabled}
                isLast={isLast}
                orientation="horizontal"
                state={dataState}
              />
            )}

            {variant === "vertical" && (
              <div className="flex gap-4">
                {!isLast && (
                  <div className="flex justify-center ps-[calc(var(--spacing)*4.5-1px)]">
                    <StepperSeparator
                      disabled={props.disabled}
                      isLast={isLast}
                      orientation="vertical"
                      state={dataState}
                    />
                  </div>
                )}
                <div className="my-3 flex-1 ps-4">{panel}</div>
              </div>
            )}
          </>
        );
      },
      Title,
      Description,
      Panel: ({ children, asChild, ...props }) => {
        const Comp = asChild ? Slot : "div";
        const { tracking } = useStepperProvider();

        return (
          <Comp
            data-component="stepper-step-panel"
            ref={(node) => scrollIntoStepperPanel(node, tracking)}
            {...props}
          >
            {children}
          </Comp>
        );
      },
      Controls: ({ children, className, asChild, ...props }) => {
        const Comp = asChild ? Slot : "div";
        return (
          <Comp
            className={cn("flex justify-end gap-4", className)}
            data-component="stepper-controls"
            {...props}
          >
            {children}
          </Comp>
        );
      },
    },
  };
};

const Title = ({
  children,
  className,
  asChild,
  ...props
}: Readonly<ComponentProps<"h4"> & { asChild?: boolean }>) => {
  const Comp = asChild ? Slot : "h4";

  return (
    <Comp
      className={cn("font-medium text-base", className)}
      data-component="stepper-step-title"
      {...props}
    >
      {children}
    </Comp>
  );
};

const Description = ({
  children,
  className,
  asChild,
  ...props
}: Readonly<ComponentProps<"p"> & { asChild?: boolean }>) => {
  const Comp = asChild ? Slot : "p";

  return (
    <Comp
      className={cn("text-muted-foreground text-sm", className)}
      data-component="stepper-step-description"
      {...props}
    >
      {children}
    </Comp>
  );
};

const StepperSeparator = ({
  orientation,
  isLast,
  labelOrientation,
  state,
  disabled,
}: Readonly<
  {
    isLast: boolean;
    state: string;
    disabled?: boolean;
  } & VariantProps<typeof classForSeparator>
>) => {
  if (isLast) {
    return null;
  }
  return (
    <hr
      className={classForSeparator({ orientation, labelOrientation })}
      data-component="stepper-separator"
      data-disabled={disabled}
      data-orientation={orientation}
      data-state={state}
    />
  );
};

const CircleStepIndicator = ({
  currentStep,
  totalSteps,
  size = 80,
  strokeWidth = 6,
}: Readonly<CircleStepIndicatorProps>) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const fillPercentage = (currentStep / totalSteps) * 100;
  const dashOffset = circumference - (circumference * fillPercentage) / 100;
  // Native <progress> cannot be styled as a circular SVG indicator.
  // Using role="progressbar" with ARIA attributes is the WAI-ARIA pattern for custom progress UIs.
  // sonar-ignore:S6853 - circular SVG requires custom markup with ARIA
  return (
    <div
      aria-valuemax={totalSteps}
      aria-valuemin={1}
      aria-valuenow={currentStep}
      className="relative inline-flex items-center justify-center"
      data-component="stepper-step-indicator"
      role="progressbar"
      tabIndex={-1}
    >
      <svg height={size} width={size}>
        <title>Step Indicator</title>
        <circle
          className="text-muted-foreground"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
        />
        <circle
          className="text-primary transition-all duration-300 ease-in-out"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeWidth={strokeWidth}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span aria-live="polite" className="font-medium text-sm">
          {currentStep} of {totalSteps}
        </span>
      </div>
    </div>
  );
};

const classForNavigationList = cva("flex gap-2", {
  variants: {
    variant: {
      horizontal: "flex-row items-center justify-between",
      vertical: "flex-col",
      circle: "flex-row items-center justify-between",
    },
  },
});

const classForSeparator = cva(
  [
    "bg-muted",
    "data-[state=completed]:bg-primary data-disabled:opacity-50",
    "transition-all duration-300 ease-in-out",
  ],
  {
    variants: {
      orientation: {
        horizontal: "h-0.5 flex-1",
        vertical: "h-full w-0.5",
      },
      labelOrientation: {
        vertical:
          "absolute top-5 right-[calc(-50%+20px)] left-[calc(50%+30px)] block shrink-0",
      },
    },
  }
);

function scrollIntoStepperPanel(
  node: HTMLDivElement | null,
  tracking?: boolean
) {
  if (tracking) {
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

const useStepChildren = (children: ReactNode) =>
  useMemo(() => extractChildren(children), [children]);

const extractChildren = (children: ReactNode) => {
  const childrenArray = Children.toArray(children);
  const map = new Map<string, ReactNode>();

  for (const child of childrenArray) {
    if (isValidElement(child)) {
      if (child.type === Title) {
        map.set("title", child);
      } else if (child.type === Description) {
        map.set("description", child);
      } else {
        map.set("panel", child);
      }
    }
  }

  return map;
};

const onStepKeyDown = (
  e: KeyboardEvent<HTMLButtonElement>,
  nextStep: StepperizeStep,
  prevStep: StepperizeStep
) => {
  const { key } = e;
  const directions = {
    next: ["ArrowRight", "ArrowDown"],
    prev: ["ArrowLeft", "ArrowUp"],
  };

  if (directions.next.includes(key) || directions.prev.includes(key)) {
    const direction = directions.next.includes(key) ? "next" : "prev";
    const step = direction === "next" ? nextStep : prevStep;

    if (!step) {
      return;
    }

    const stepElement = document.getElementById(`step-${step.id}`);
    if (!stepElement) {
      return;
    }

    const isActive = stepElement.parentElement?.dataset.state !== "inactive";
    if (isActive || direction === "prev") {
      stepElement.focus();
    }
  }
};

const getStepState = (currentIndex: number, stepIndex: number) => {
  if (currentIndex === stepIndex) {
    return "active";
  }
  if (currentIndex > stepIndex) {
    return "completed";
  }
  return "inactive";
};

type StepperVariant = "horizontal" | "vertical" | "circle";
type StepperLabelOrientation = "horizontal" | "vertical";

interface StepperConfigProps {
  variant?: StepperVariant;
  labelOrientation?: StepperLabelOrientation;
  tracking?: boolean;
}

type StepperDefineProps<Steps extends StepperizeStep[]> = Omit<
  StepperReturn<Steps>,
  "Scoped"
> & {
  Stepper: {
    Provider: (
      props: Omit<ScopedProps<Steps>, "children"> &
        Omit<ComponentProps<"div">, "children"> &
        StepperConfigProps & {
          children:
            | ReactNode
            | ((props: { methods: StepperizeContext<Steps> }) => ReactNode);
        }
    ) => ReactElement;
    Navigation: (props: ComponentProps<"nav">) => ReactElement;
    Step: (
      props: ComponentProps<"button"> & {
        of: StepperizeGet.Id<Steps>;
        icon?: ReactNode;
      }
    ) => ReactElement;
    Title: (props: AsChildProps<"h4">) => ReactElement;
    Description: (props: AsChildProps<"p">) => ReactElement;
    Panel: (props: AsChildProps<"div">) => ReactElement;
    Controls: (props: AsChildProps<"div">) => ReactElement;
  };
};

interface CircleStepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  size?: number;
  strokeWidth?: number;
}

type AsChildProps<T extends ElementType> = ComponentProps<T> & {
  asChild?: boolean;
};

export { defineStepper };
