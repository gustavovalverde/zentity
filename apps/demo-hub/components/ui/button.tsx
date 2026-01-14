"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"

import { buttonVariants, type ButtonVariantProps } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & ButtonVariantProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
export { buttonVariants } from "@/components/ui/button-variants"
export type { ButtonVariantProps } from "@/components/ui/button-variants"
